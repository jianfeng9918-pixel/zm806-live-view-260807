import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const rawDir = path.join(projectRoot, "data", "raw");
const snapshotDir = path.join(projectRoot, "data", "snapshots");
const stateDir = path.join(projectRoot, "data", "state");
const reportPath = path.join(projectRoot, "public", "data", "report.json");
const lockPath = path.join(projectRoot, "data", ".stage1-refresh.lock");
const requiredSheets = [
  "门店_总储值目标达成率",
  "门店_今日目标达成率排行",
  "门店_目标达成与奖金",
  "销售地区_今日储值目标达成率",
  "销售地区_目标达成与奖金",
];
const requiredFunctionalSheets = [
  "职能部门_储值目标达成率",
  "集团总目标_2026806",
];
const maximumWorkbookBytes = 5 * 1024 * 1024;
const maximumFunctionalWorkbookBytes = 1024 * 1024;
const args = parseArgs(process.argv.slice(2));

if (!args.input || !args.functionalInput) {
  throw new Error("请同时使用 --input 和 --functional-input 指定门店区域与职能BI导出文件");
}

const inputPath = path.resolve(args.input);
const functionalInputPath = path.resolve(args.functionalInput);
await fs.mkdir(path.dirname(lockPath), { recursive: true });
const lock = await acquireLock(lockPath);

try {
  const stableStat = await waitForStableFile(inputPath, 10_000);
  const functionalStableStat = await waitForStableFile(functionalInputPath, 3_000);
  if (stableStat.size > maximumWorkbookBytes) {
    throw new Error(`导出文件异常过大（${formatBytes(stableStat.size)}），请确认只选择5张战报表，禁止全选`);
  }
  if (functionalStableStat.size > maximumFunctionalWorkbookBytes) {
    throw new Error(`职能导出文件异常过大（${formatBytes(functionalStableStat.size)}），请确认只选择2张职能校验表，禁止全选`);
  }

  const workbook = XLSX.readFile(inputPath, { cellDates: true });
  const functionalWorkbook = XLSX.readFile(functionalInputPath, { cellDates: true });
  validateWorkbook(workbook);
  validateFunctionalWorkbook(functionalWorkbook);

  const generatedAt = args.generatedAt ?? shanghaiIso(new Date());
  const stamp = generatedAt.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const rawName = `806-store-export-${stamp}.xlsx`;
  const functionalRawName = `806-functional-export-${stamp}.xlsx`;
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(snapshotDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  const rawPath = await uniqueDestination(path.join(rawDir, rawName));
  const functionalRawPath = await uniqueDestination(path.join(rawDir, functionalRawName));
  await fs.copyFile(inputPath, rawPath);
  await fs.copyFile(functionalInputPath, functionalRawPath);

  const previousReport = await fs.readFile(reportPath).catch(() => null);
  const snapshotsBefore = new Set(await fs.readdir(snapshotDir).catch(() => []));

  try {
    execFileSync(process.execPath, [
      path.join(scriptDir, "update-report.mjs"),
      "--input",
      rawPath,
      "--functional-input",
      functionalRawPath,
      "--generated-at",
      generatedAt,
    ], { cwd: projectRoot, stdio: "inherit" });

    if (!args.skipVerify) {
      execFileSync("npm", ["run", "verify"], { cwd: projectRoot, stdio: "inherit" });
    }
  } catch (error) {
    if (previousReport) await fs.writeFile(reportPath, previousReport);
    const snapshotsAfter = await fs.readdir(snapshotDir).catch(() => []);
    await Promise.all(snapshotsAfter
      .filter((name) => !snapshotsBefore.has(name))
      .map((name) => fs.rm(path.join(snapshotDir, name), { force: true })));
    throw error;
  }

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  const state = {
    status: "success",
    generatedAt,
    sourceFile: path.basename(rawPath),
    functionalSourceFile: path.basename(functionalRawPath),
    sourceBytes: stableStat.size + functionalStableStat.size,
    sourceSha256: await sha256(rawPath),
    functionalSourceSha256: await sha256(functionalRawPath),
    sheetCount: workbook.SheetNames.length + functionalWorkbook.SheetNames.length,
    primarySheetCount: workbook.SheetNames.length,
    functionalSheetCount: functionalWorkbook.SheetNames.length,
    stores: report.stores.length,
    regions: report.regions.length,
    todayAmount: report.hq.today.amount,
    cumulativeAmount: report.hq.cumulative.amount,
    comparisonMinutes: report.summary.comparisonMinutes,
  };
  await fs.writeFile(path.join(stateDir, "last-refresh.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

  if (args.trashSource) {
    await moveDownloadToTrash(inputPath);
    await moveDownloadToTrash(functionalInputPath);
  }
  console.log(JSON.stringify(state, null, 2));
} finally {
  await lock.close();
  await fs.rm(lockPath, { force: true });
}

function validateWorkbook(workbook) {
  const missing = requiredSheets.filter((name) => !workbook.SheetNames.includes(name));
  if (missing.length) throw new Error(`BI导出缺少必需工作表：${missing.join("、")}`);
  if (workbook.SheetNames.length !== requiredSheets.length) {
    throw new Error(`门店区域导出包含${workbook.SheetNames.length}张表；必须只导出指定5张战报表`);
  }

  const minimumRows = new Map([
    ["门店_总储值目标达成率", 100],
    // BI 的今日排行只返回当天已有充值记录的门店；完整门店范围由另外两张门店表校验。
    ["门店_今日目标达成率排行", 3],
    ["门店_目标达成与奖金", 100],
    ["销售地区_今日储值目标达成率", 10],
    ["销售地区_目标达成与奖金", 10],
  ]);
  for (const [name, minimum] of minimumRows) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null });
    if (rows.length < minimum) throw new Error(`工作表 ${name} 数据不足（${rows.length}行）`);
  }
}

function validateFunctionalWorkbook(workbook) {
  const missing = requiredFunctionalSheets.filter((name) => !workbook.SheetNames.includes(name));
  if (missing.length) throw new Error(`职能导出缺少必需工作表：${missing.join("、")}`);
  if (workbook.SheetNames.length !== requiredFunctionalSheets.length) {
    throw new Error(`职能导出包含${workbook.SheetNames.length}张表；必须只导出指定2张职能校验表`);
  }

  const minimumRows = new Map([
    ["职能部门_储值目标达成率", 10],
    ["集团总目标_2026806", 4],
  ]);
  for (const [name, minimum] of minimumRows) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null });
    if (rows.length < minimum) throw new Error(`工作表 ${name} 数据不足（${rows.length}行）`);
  }
}

async function waitForStableFile(filePath, minimumBytes) {
  const first = await fs.stat(filePath);
  if (!first.isFile() || first.size < minimumBytes) throw new Error("BI导出文件不存在或内容过小");
  await new Promise((resolve) => setTimeout(resolve, 800));
  const second = await fs.stat(filePath);
  if (first.size !== second.size) throw new Error("BI导出仍在写入，请等待下载完成后重试");
  return second;
}

async function acquireLock(filePath) {
  try {
    return await fs.open(filePath, "wx");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || Date.now() - stat.mtimeMs > 20 * 60_000) {
      await fs.rm(filePath, { force: true });
      return fs.open(filePath, "wx");
    }
    throw new Error("已有806刷新任务正在运行，本次不重复执行");
  }
}

async function uniqueDestination(preferredPath) {
  try {
    await fs.access(preferredPath);
  } catch {
    return preferredPath;
  }
  const ext = path.extname(preferredPath);
  const base = preferredPath.slice(0, -ext.length);
  return `${base}-${Date.now()}${ext}`;
}

async function sha256(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function moveDownloadToTrash(filePath) {
  const downloadsDir = path.resolve(os.homedir(), "Downloads");
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== downloadsDir) return;
  const trashDir = path.resolve(os.homedir(), ".Trash");
  await fs.mkdir(trashDir, { recursive: true });
  const target = await uniqueDestination(path.join(trashDir, path.basename(resolved)));
  await fs.rename(resolved, target);
}

function shanghaiIso(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function parseArgs(values) {
  const parsed = {
    input: null,
    functionalInput: null,
    generatedAt: null,
    skipVerify: false,
    trashSource: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--input") parsed.input = values[++index];
    else if (value === "--functional-input") parsed.functionalInput = values[++index];
    else if (value === "--generated-at") parsed.generatedAt = values[++index];
    else if (value === "--skip-verify") parsed.skipVerify = true;
    else if (value === "--trash-source") parsed.trashSource = true;
  }
  return parsed;
}
