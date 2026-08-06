import assert from "node:assert/strict";
import fs from "node:fs/promises";

const report = JSON.parse(await fs.readFile(new URL("../public/data/report.json", import.meta.url), "utf8"));

assert.equal(report.schemaVersion, 1);
assert.equal(report.timezone, "Asia/Shanghai");
assert.ok(report.stores.length >= 100, "应包含100家以上门店");
assert.ok(report.regions.length >= 10, "应包含完整区域");
assert.equal(new Set(report.stores.map((store) => store.id)).size, report.stores.length, "门店ID不能重复");
assert.equal(new Set(report.regions.map((region) => region.id)).size, report.regions.length, "区域ID不能重复");
assert.ok(report.hq.today.amount > 0, "总部今日金额应大于0");
assert.ok(report.hq.cumulative.amount >= report.hq.today.amount, "累计金额不能小于今日金额");

const regionStoreCount = report.regions.reduce((total, region) => total + region.storeCount, 0);
assert.equal(regionStoreCount, report.stores.length, "区域门店数量应与门店总数一致");

const completedRegions = report.regions.filter((region) => region.today.targetAmount > 0 && region.today.completionRate >= 1);
assert.deepEqual(
  new Set(report.summary.completedRegionIds),
  new Set(completedRegions.map((region) => region.id)),
  "区域达标清单计算错误",
);

const lowest = report.regions
  .filter((region) => region.today.targetAmount > 0)
  .sort((a, b) => a.today.completionRate - b.today.completionRate || a.name.localeCompare(b.name, "zh-CN"))[0];
assert.equal(report.summary.lowestRegionId, lowest.id, "最低区域计算错误");

for (const store of report.stores) {
  assert.ok(store.cumulative.targets.challenge >= 0);
  assert.ok(store.cumulative.rates.challenge >= 0);
  assert.ok(Number.isFinite(store.today.amount));
  assert.ok(store.rankChanges30 && "todayChallenge" in store.rankChanges30, "门店应包含今日排名变化字段");
  assert.ok("cumulativeChallenge" in store.rankChanges30, "门店应包含累计排名变化字段");
  assert.equal(store.rankChange30, store.rankChanges30.cumulativeChallenge, "旧排名字段应与累计变化保持一致");
}

for (const region of report.regions) {
  assert.ok(region.rankChanges30 && "todayChallenge" in region.rankChanges30, "区域应包含今日排名变化字段");
  assert.ok("cumulativeChallenge" in region.rankChanges30, "区域应包含累计排名变化字段");
}

console.log(JSON.stringify({
  status: "passed",
  stores: report.stores.length,
  regions: report.regions.length,
  completedRegions: completedRegions.map((region) => region.name),
  lowestRegion: lowest.name,
}, null, 2));
