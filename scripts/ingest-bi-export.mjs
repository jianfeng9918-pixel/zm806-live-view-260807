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
const maximumWorkbookBytes = 5 * 1024 * 1024;
const maximumSheetCount = 8;
const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  throw new Error("请使用 --input 指定本次BI导出的Excel文件");
}

const inputPath = path.resolve(args.input);
await fs.mkdir(path.dirname(lockPath), { recursive: true });
const lock = await acquireLock(lockPath);

try {
  const stableStat = await waitForStableFile(inputPath);
  if (stableStat.size > maximumWorkbookBytes) {
    throw new Error(`导出文件异常过大（${formatBytes(stableStat.size)}），请确认只选择5张战报表，禁止全选`);
  }

  const workbook = XLSX.readFile(inputPath, { cellDates: true });
  validateWorkbook(workbook);

  const generatedAt = args.generatedAt ?? shanghaiIso(new Date());
  const stamp = generatedAt.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const rawName = `806-export-${stamp}.xlsx`;
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(snapshotDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  const rawPath = await uniqueDestination(path.join(rawDir, rawName));
  await fs.copyFile(inputPath, rawPath);

  const previousReport = await fs.readFile(reportPath).catch(() => null);
  const snapshotsBefore = new Set(await fs.readdir(snapshotDir).catch(() => []));

  try {
    execFileSync(process.execPath, [
      path.join(scriptDir, "update-report.mjs"),
      "--input",
      rawPath,
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
    sourceBytes: stableStat.size,
    sourceSha256: await sha256(rawPath),
    sheetCount: workbook.SheetNames.length,
    stores: report.stores.length,
    regions: report.regions.length,
    todayAmount: report.hq.today.amount,
    cumulativeAmount: report.hq.cumulative.amount,
    comparisonMinutes: report.summary.comparisonMinutes,
  };
  await fs.writeFile(path.join(stateDir, "last-refresh.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

  if (args.trashSource) await moveDownloadToTrash(inputPath);
  console.log(JSON.stringify(state, null, 2));
} finally {
  await lock.close();
  await fs.rm(lockPath, { force: true });
}

function validateWorkbook(workbook) {
  const missing = requiredSheets.filter((name) => !workbook.SheetNames.includes(name));
  if (missing.length) throw new Error(`BI导出缺少必需工作表：${missing.join("、")}`);
  if (workbook.SheetNames.length > maximumSheetCount) {
    throw new Error(`BI导出包含${workbook.SheetNames.length}张表，疑似误点全选；应只导出5张战报表`);
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

async function waitForStableFile(filePath) {
  const first = await fs.stat(filePath);
  if (!first.isFile() || first.size < 10_000) throw new Error("BI导出文件不存在或内容过小");
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
  const parsed = { input: null, generatedAt: null, skipVerify: false, trashSource: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--input") parsed.input = values[++index];
    else if (value === "--generated-at") parsed.generatedAt = values[++index];
    else if (value === "--skip-verify") parsed.skipVerify = true;
    else if (value === "--trash-source") parsed.trashSource = true;
  }
  return parsed;
}
