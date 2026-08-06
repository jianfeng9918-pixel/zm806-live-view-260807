import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import {
  differenceRate,
  findLatestPriorSnapshot,
  findThirtyMinuteSnapshot,
  selectAttentionStoreIds,
  selectCompletedRegionIds,
  selectFastestStoreIds,
  selectLowestRegionId,
} from "./report-rules.mjs";

const regions = [
  region("zero", "零目标区域", 0, 3),
  region("done-a", "达标甲区", 100, 1.2),
  region("done-b", "达标乙区", 100, 1),
  region("low-a", "低位甲区", 100, 0.4),
  region("low-b", "低位乙区", 100, 0.4),
];

assert.deepEqual(selectCompletedRegionIds(regions), ["done-a", "done-b"], "多个区域达标应按达成率排序");
assert.deepEqual(selectCompletedRegionIds(regions.map((item) => region(item.id, item.name, item.today.targetAmount, 0.9))), [], "应覆盖无区域达标");
assert.notEqual(selectLowestRegionId(regions), "zero", "零目标区域不能进入最低区域预警");
assert.equal(selectLowestRegionId([region("only-zero", "零目标", 0, 0)]), null, "全部目标为零时不应虚构最低区域");
const tiedLowest = [regions[3], regions[4]].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))[0].id;
assert.equal(selectLowestRegionId(regions), tiedLowest, "并列最低应使用稳定中文名称排序");

const stores = [
  store("zero", "零目标店", 0, 0, -100),
  store("done", "已完成店", 100, 1.1, -100),
  store("slow-a", "待督促甲店", 100, 0.2, 0),
  store("slow-b", "待督促乙店", 100, 0.1, 0),
  store("fast", "增长店", 100, 0.3, 500),
];
assert.deepEqual(selectAttentionStoreIds(stores, true).slice(0, 2), ["slow-b", "slow-a"], "待督促应先按增长、再按达成率");
assert.equal(selectAttentionStoreIds(stores, true).includes("zero"), false, "零目标门店不能进入督促榜");
assert.equal(selectAttentionStoreIds(stores, true).includes("done"), false, "已完成挑战目标门店不能进入督促榜");
assert.equal(selectFastestStoreIds(stores)[0], "fast", "最快门店应按30分钟新增金额排序");

const currentAt = "2026-08-06T16:00:00+08:00";
const snapshots = [
  { generatedAt: "2026-08-06T15:39:00+08:00", id: "21-min" },
  { generatedAt: "2026-08-06T15:30:00+08:00", id: "30-min" },
  { generatedAt: "2026-08-06T15:19:00+08:00", id: "41-min" },
];
assert.equal(findThirtyMinuteSnapshot(snapshots, currentAt)?.id, "30-min", "应选择最接近30分钟前的成功快照");
assert.equal(findThirtyMinuteSnapshot([{ generatedAt: "2026-08-06T15:19:00+08:00" }], currentAt), null, "超过10分钟误差不得比较");
assert.equal(findLatestPriorSnapshot(snapshots, currentAt)?.id, "21-min", "人工更新错过30分钟窗口时应选择最近成功快照");
assert.equal(findLatestPriorSnapshot([{ generatedAt: "2026-08-06T13:59:00+08:00" }], currentAt), null, "超过2小时不得回退比较");
assert.equal(differenceRate(100, 98), 0.02);
assert.equal(differenceRate(0, 0), 0);
assert.equal(differenceRate(0, 1), 1);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(projectRoot, "public", "data", "report.json");
const beforeHash = sha256(reportPath);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "806-report-test-"));
const invalidWorkbookPath = path.join(tempDir, "invalid.xlsx");
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["不是有效BI导出"]]), "无效工作表");
XLSX.writeFile(workbook, invalidWorkbookPath);
let failed = false;
try {
  execFileSync(process.execPath, [path.join(projectRoot, "scripts", "update-report.mjs"), "--input", invalidWorkbookPath], {
    cwd: projectRoot,
    stdio: "pipe",
  });
} catch {
  failed = true;
}
assert.equal(failed, true, "无效BI工作簿必须更新失败");
assert.equal(sha256(reportPath), beforeHash, "更新失败时必须保留最后一次成功report.json");
fs.rmSync(tempDir, { recursive: true, force: true });

console.log(JSON.stringify({
  status: "passed",
  cases: ["no-completed-region", "multiple-completed-regions", "zero-target", "tied-lowest", "manual-window-fallback", "failed-update-preserves-report"],
}, null, 2));

function region(id, name, targetAmount, completionRate) {
  return { id, name, today: { targetAmount, completionRate } };
}

function store(id, name, challengeTarget, challengeRate, delta30) {
  return {
    id,
    name,
    delta30,
    cumulative: { targets: { challenge: challengeTarget }, rates: { challenge: challengeRate } },
  };
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
