import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import {
  aggregateHeadquartersAmounts,
  calculateRankChange,
  differenceRate,
  findLatestPriorSnapshot,
  findThirtyMinuteSnapshot,
  isComparableHeadquartersSnapshot,
  selectAttentionStoreIds,
  selectCompletedRegionIds,
  selectFastestStoreIds,
  selectLowestRegionId,
} from "./report-rules.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const snapshotDir = path.join(projectRoot, "data", "snapshots");
const reportPath = path.join(projectRoot, "public", "data", "report.json");
const args = parseArgs(process.argv.slice(2));

if (!args.input || !args.functionalInput) {
  throw new Error("请同时使用 --input 和 --functional-input 指定门店区域与职能BI导出文件");
}

const inputPath = path.resolve(projectRoot, args.input);
const functionalInputPath = path.resolve(projectRoot, args.functionalInput);
const generatedAt = args.generatedAt ?? shanghaiIso(new Date());

const workbook = XLSX.readFile(inputPath, { cellDates: true });
const functionalWorkbook = XLSX.readFile(functionalInputPath, { cellDates: true });
const data = buildReport(
  workbook,
  functionalWorkbook,
  generatedAt,
  path.basename(inputPath),
  path.basename(functionalInputPath),
);
const previousSnapshots = await readSnapshots(snapshotDir);
const thirtyMinuteSnapshot = findThirtyMinuteSnapshot(previousSnapshots, generatedAt);
const previous = thirtyMinuteSnapshot ?? findLatestPriorSnapshot(previousSnapshots, generatedAt);
applySnapshotComparisons(data, previous, previousSnapshots, Boolean(thirtyMinuteSnapshot));

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.mkdir(snapshotDir, { recursive: true });

if (!args.dryRun) {
  await fs.writeFile(reportPath, `${JSON.stringify(data)}\n`, "utf8");
  const snapshotPath = path.join(snapshotDir, `${generatedAt.replaceAll(":", "-")}.json`);
  await fs.writeFile(snapshotPath, `${JSON.stringify(toSnapshot(data), null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  input: path.relative(projectRoot, inputPath),
  functionalInput: path.relative(projectRoot, functionalInputPath),
  output: path.relative(projectRoot, reportPath),
  generatedAt,
  stores: data.stores.length,
  regions: data.regions.length,
  todayAmount: data.hq.today.amount,
  cumulativeAmount: data.hq.cumulative.amount,
  completedRegions: data.summary.completedRegionIds.length,
  previousSnapshot: previous?.generatedAt ?? null,
  status: data.source.reconciliation.status,
}, null, 2));

function buildReport(wb, functionalWb, timestamp, sourceFile, functionalSourceFile) {
  const cumulativeRows = rows(wb, "门店_总储值目标达成率");
  const todayRows = rows(wb, "门店_今日目标达成率排行");
  const targetRows = rows(wb, "门店_目标达成与奖金");
  const regionTodayRows = rows(wb, "销售地区_今日储值目标达成率");
  const regionTargetRows = rows(wb, "销售地区_目标达成与奖金");
  const functionalRows = rows(functionalWb, "职能部门_储值目标达成率");
  const groupRows = rows(functionalWb, "集团总目标_2026806");

  requireRows("门店_总储值目标达成率", cumulativeRows, 3);
  requireRows("门店_今日目标达成率排行", todayRows, 3);
  requireRows("门店_目标达成与奖金", targetRows, 3);
  requireRows("销售地区_今日储值目标达成率", regionTodayRows, 3);
  requireRows("销售地区_目标达成与奖金", regionTargetRows, 3);
  requireRows("职能部门_储值目标达成率", functionalRows, 10);
  requireRows("集团总目标_2026806", groupRows, 4);

  const hqCumulativeRow = cumulativeRows.find((row) => row[0] === "总计");
  const hqTodayRow = todayRows.find((row) => row[0] === "总计");
  const functionalTotalRow = functionalRows.find((row) => row[0] === "总计");
  const groupTotalRow = groupRows.find((row) => row[0] === "总计");
  const groupStoreRow = groupRows.find((row) => row[0] === "门店端");
  const groupFunctionalRow = groupRows.find((row) => row[0] === "职能端");
  const cumulativeRank = rankMap(cumulativeRows, 2);
  const todayRank = rankMap(todayRows, 2);

  const cumulativeByStore = mapByName(cumulativeRows.slice(2));
  const todayByStore = mapByName(todayRows.slice(2));
  const targetByStore = mapByName(targetRows.slice(2));
  const storeNames = [...new Set(targetRows.slice(2)
    .map((row) => text(row[0]))
    .filter((name) => name && name !== "总计" && name !== "门店名称"))];

  const stores = storeNames.map((name) => {
    const cumulative = cumulativeByStore.get(name) ?? [];
    const today = todayByStore.get(name) ?? [];
    const target = targetByStore.get(name) ?? [];
    const regionName = text(target[1] ?? cumulative[1] ?? today[1]) || "未分区域";
    const challengeTarget = number(target[9] ?? cumulative[6]);
    const cumulativeAmount = number(target[3] ?? cumulative[5]);
    const todayTarget = number(today[6]);
    const todayAmount = number(today[5]);

    return {
      id: stableId("store", `${regionName}|${name}`),
      name,
      regionId: stableId("region", regionName),
      regionName,
      status: text(target[2]) || null,
      bonus: number(target[14]),
      tierOrders: {
        tier388: number(target[10]),
        tier688: number(target[11]),
        tier1288: number(target[12]),
        tier1888: number(target[13]),
      },
      ranking: {
        cumulativeChallenge: cumulativeRank.get(name) ?? null,
        todayChallenge: todayRank.get(name) ?? null,
      },
      cumulative: {
        amount: cumulativeAmount,
        orderCount: number(cumulative[2]),
        targetOrderCount: number(cumulative[3]),
        orderCompletionRate: rate(cumulative[4]),
        targets: {
          bet: number(target[7]),
          drive: number(target[8]),
          challenge: challengeTarget,
        },
        rates: {
          bet: rate(target[4]),
          drive: rate(target[5]),
          challenge: rate(target[6] ?? cumulative[7]),
        },
      },
      today: {
        amount: todayAmount,
        orderCount: number(today[2]),
        targetOrderCount: number(today[3]),
        orderCompletionRate: rate(today[4]),
        targetAmount: todayTarget,
        completionRate: rate(today[7]),
      },
      delta30: null,
      todayDelta30: null,
      rankChange30: null,
      rankChanges30: {
        cumulativeChallenge: null,
        todayChallenge: null,
      },
      trend: [],
    };
  });

  const regionCumulativeRank = rankMap(regionTargetRows, 2);
  const regionTodayRank = rankMap(regionTodayRows, 2);
  const regionTargetByName = mapByName(regionTargetRows.slice(2));
  const regionTodayByName = mapByName(regionTodayRows.slice(2));
  const regionNames = [...new Set([
    ...regionTargetRows.slice(2).map((row) => text(row[0])),
    ...regionTodayRows.slice(2).map((row) => text(row[0])),
  ].filter((name) => name && name !== "总计" && name !== "销售地区"))];

  const regions = regionNames.map((name) => {
    const cumulative = regionTargetByName.get(name) ?? [];
    const today = regionTodayByName.get(name) ?? [];
    const amount = number(cumulative[2]);
    const targets = {
      bet: number(cumulative[6]),
      drive: number(cumulative[7]),
      challenge: number(cumulative[8]),
    };

    return {
      id: stableId("region", name),
      name,
      managerName: null,
      storeCount: stores.filter((store) => store.regionName === name).length,
      ranking: {
        cumulativeChallenge: regionCumulativeRank.get(name) ?? null,
        todayChallenge: regionTodayRank.get(name) ?? null,
      },
      cumulative: {
        amount,
        targets,
        rates: {
          bet: rate(cumulative[3]) || ratio(amount, targets.bet),
          drive: rate(cumulative[4]) || ratio(amount, targets.drive),
          challenge: rate(cumulative[5]) || ratio(amount, targets.challenge),
        },
        bonus: number(cumulative[13]),
      },
      today: {
        amount: number(today[4]),
        orderCount: number(today[1]),
        targetOrderCount: number(today[2]),
        orderCompletionRate: rate(today[3]),
        targetAmount: number(today[5]),
        completionRate: rate(today[6]),
      },
      delta30: null,
      todayDelta30: null,
      rankChanges30: {
        cumulativeChallenge: null,
        todayChallenge: null,
      },
      trend: [],
    };
  });

  const storeCumulativeSum = sum(stores.map((store) => store.cumulative.amount));
  const storeTodaySum = sum(stores.map((store) => store.today.amount));
  const storeOfficialCumulative = number(hqCumulativeRow?.[5]);
  const storeOfficialToday = number(hqTodayRow?.[5]);
  const functionalCumulative = number(functionalTotalRow?.[2]);
  const functionalToday = number(functionalTotalRow?.[5]);
  const functionalTarget = number(functionalTotalRow?.[3]);
  const functionalOrderCount = number(functionalTotalRow?.[1]);
  const functionalDetailRows = functionalRows.filter((row) => {
    const name = text(row[0]);
    return name && name !== "总计" && name !== "部门名称";
  });
  const functionalDetailCumulative = sum(functionalDetailRows.map((row) => number(row[2])));
  const functionalDetailToday = sum(functionalDetailRows.map((row) => number(row[5])));
  const groupCumulativeOfficial = number(groupTotalRow?.[2]);
  const groupStoreOfficial = number(groupStoreRow?.[2]);
  const groupFunctionalOfficial = number(groupFunctionalRow?.[2]);
  const aggregation = aggregateHeadquartersAmounts({
    storeCumulative: storeCumulativeSum,
    storeToday: storeTodaySum,
    functionalCumulative,
    functionalToday,
    groupCumulativeOfficial,
  });
  const reconciliationRates = [
    differenceRate(storeOfficialCumulative, storeCumulativeSum),
    differenceRate(storeOfficialToday, storeTodaySum),
    differenceRate(functionalCumulative, functionalDetailCumulative),
    differenceRate(functionalToday, functionalDetailToday),
    aggregation.groupDifferenceRate,
    differenceRate(groupStoreOfficial, storeCumulativeSum),
    differenceRate(groupFunctionalOfficial, functionalCumulative),
  ];
  const reconciliationStatus = Math.max(...reconciliationRates) > 0.01
    ? "warning"
    : "matched";

  const completedRegionIds = selectCompletedRegionIds(regions);
  const lowestRegionId = selectLowestRegionId(regions);
  const fallbackAttention = selectAttentionStoreIds(stores, false);

  const hqBetTarget = sum(stores.map((store) => store.cumulative.targets.bet));
  const hqDriveTarget = sum(stores.map((store) => store.cumulative.targets.drive));
  const storeChallengeTarget = number(hqCumulativeRow?.[6])
    || sum(stores.map((store) => store.cumulative.targets.challenge));
  const hqChallengeTarget = storeChallengeTarget + functionalTarget;

  return {
    schemaVersion: 1,
    campaign: "周麻婆14周年806储值战报",
    generatedAt: timestamp,
    timezone: "Asia/Shanghai",
    freshness: {
      status: "fresh",
      staleAfterMinutes: 45,
      message: null,
    },
    source: {
      type: "bi-excel",
      workbook: sourceFile,
      functionalWorkbook: functionalSourceFile,
      dashboard: "15_2026版_806活动储值分析",
      functionalDashboard: "16_26年版_806会员储值清单与职能目标",
      aggregationVersion: "store-plus-functional-v1",
      reconciliation: {
        status: reconciliationStatus,
        cumulative: {
          official: groupCumulativeOfficial || aggregation.cumulativeAmount,
          storeSum: storeCumulativeSum,
          functionalSum: functionalCumulative,
          combinedSum: aggregation.cumulativeAmount,
          differenceRate: aggregation.groupDifferenceRate,
        },
        today: {
          official: aggregation.todayAmount,
          storeSum: storeTodaySum,
          functionalSum: functionalToday,
          combinedSum: aggregation.todayAmount,
          differenceRate: Math.max(
            differenceRate(storeOfficialToday, storeTodaySum),
            differenceRate(functionalToday, functionalDetailToday),
          ),
        },
      },
    },
    defaults: {
      scope: "hq",
      mode: "today",
      featuredStoreId: stores.find((store) => store.name === "福州晋安三盛广场店")?.id ?? stores[0]?.id ?? null,
    },
    hq: {
      storeCount: stores.length,
      activeStoreCount: stores.filter((store) => store.today.amount > 0).length,
      bonus: sum(stores.map((store) => store.bonus)),
      functional: {
        departmentCount: functionalDetailRows.filter((row) => text(row[0]) !== "其他门店").length,
        cumulative: {
          amount: functionalCumulative,
          orderCount: functionalOrderCount,
          targetAmount: functionalTarget,
          completionRate: ratio(functionalCumulative, functionalTarget),
        },
        today: {
          amount: functionalToday,
        },
      },
      cumulative: {
        amount: aggregation.cumulativeAmount,
        orderCount: number(hqCumulativeRow?.[2]) + functionalOrderCount,
        targetOrderCount: number(hqCumulativeRow?.[3]),
        orderCompletionRate: rate(hqCumulativeRow?.[4]),
        targets: { bet: hqBetTarget, drive: hqDriveTarget, challenge: hqChallengeTarget },
        rates: {
          bet: ratio(storeCumulativeSum, hqBetTarget),
          drive: ratio(storeCumulativeSum, hqDriveTarget),
          challenge: ratio(aggregation.cumulativeAmount, hqChallengeTarget),
        },
      },
      today: {
        amount: aggregation.todayAmount,
        orderCount: number(hqTodayRow?.[2]),
        targetOrderCount: number(hqTodayRow?.[3]),
        orderCompletionRate: rate(hqTodayRow?.[4]),
        targetAmount: number(hqTodayRow?.[6]),
        completionRate: ratio(aggregation.todayAmount, number(hqTodayRow?.[6])),
      },
      delta30: null,
      todayDelta30: null,
      trend: [],
    },
    summary: {
      deltaBasis: "waiting-for-next-snapshot",
      comparisonMinutes: null,
      comparisonFrom: null,
      fastestStoreIds: [],
      attentionStoreIds: fallbackAttention,
      completedRegionIds,
      lowestRegionId,
      noGrowthStoreCount: null,
      noGrowthRegionCount: null,
    },
    regions,
    stores,
  };
}

function applySnapshotComparisons(report, previous, history, isThirtyMinuteComparison) {
  const uniqueSnapshots = new Map([...history, toSnapshot(report)].map((snapshot) => [snapshot.generatedAt, snapshot]));
  const chronological = [...uniqueSnapshots.values()]
    .sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt))
    .slice(-5);
  const previousStores = new Map((previous?.stores ?? []).map((store) => [store.id, store]));
  const previousRegions = new Map((previous?.regions ?? []).map((region) => [region.id, region]));

  for (const store of report.stores) {
    const prior = previousStores.get(store.id);
    if (prior) {
      store.delta30 = store.cumulative.amount - prior.cumulativeAmount;
      store.todayDelta30 = store.today.amount - prior.todayAmount;
      store.rankChanges30 = {
        cumulativeChallenge: calculateRankChange(prior.cumulativeRank, store.ranking.cumulativeChallenge),
        todayChallenge: calculateRankChange(prior.todayRank, store.ranking.todayChallenge),
      };
      store.rankChange30 = store.rankChanges30.cumulativeChallenge;
    }
    store.trend = chronological
      .map((snapshot) => {
        const point = snapshot.stores.find((item) => item.id === store.id);
        return point ? { at: snapshot.generatedAt, amount: point.cumulativeAmount } : null;
      })
      .filter(Boolean);
  }

  for (const region of report.regions) {
    const prior = previousRegions.get(region.id);
    if (prior) {
      region.delta30 = region.cumulative.amount - prior.cumulativeAmount;
      region.todayDelta30 = region.today.amount - prior.todayAmount;
      region.rankChanges30 = {
        cumulativeChallenge: calculateRankChange(prior.cumulativeRank, region.ranking.cumulativeChallenge),
        todayChallenge: calculateRankChange(prior.todayRank, region.ranking.todayChallenge),
      };
    }
    region.trend = chronological
      .map((snapshot) => {
        const point = snapshot.regions.find((item) => item.id === region.id);
        return point ? { at: snapshot.generatedAt, amount: point.cumulativeAmount } : null;
      })
      .filter(Boolean);
  }

  if (previous) {
    if (isComparableHeadquartersSnapshot(previous)) {
      report.hq.delta30 = report.hq.cumulative.amount - previous.hq.cumulativeAmount;
      report.hq.todayDelta30 = report.hq.today.amount - previous.hq.todayAmount;
    }
    report.summary.deltaBasis = isThirtyMinuteComparison
      ? "closest-snapshot-to-30-minutes"
      : "latest-available-snapshot";
    report.summary.comparisonMinutes = Math.round(
      ((Date.parse(report.generatedAt) - Date.parse(previous.generatedAt)) / 60000) * 10,
    ) / 10;
    report.summary.comparisonFrom = previous.generatedAt;
    report.summary.fastestStoreIds = selectFastestStoreIds(report.stores);
    report.summary.attentionStoreIds = selectAttentionStoreIds(report.stores, true);
    report.summary.noGrowthStoreCount = report.stores
      .filter((store) => Number.isFinite(store.delta30) && store.delta30 <= 0).length;
    report.summary.noGrowthRegionCount = report.regions
      .filter((region) => Number.isFinite(region.delta30) && region.delta30 <= 0).length;
  }

  report.hq.trend = chronological
    .filter(isComparableHeadquartersSnapshot)
    .map((snapshot) => ({
      at: snapshot.generatedAt,
      amount: snapshot.hq.cumulativeAmount,
    }));
}

function toSnapshot(report) {
  return {
    generatedAt: report.generatedAt,
    hq: {
      aggregationVersion: report.source.aggregationVersion,
      cumulativeAmount: report.hq.cumulative.amount,
      todayAmount: report.hq.today.amount,
      functionalCumulativeAmount: report.hq.functional.cumulative.amount,
      functionalTodayAmount: report.hq.functional.today.amount,
    },
    regions: report.regions.map((region) => ({
      id: region.id,
      cumulativeAmount: region.cumulative.amount,
      todayAmount: region.today.amount,
      cumulativeRank: region.ranking.cumulativeChallenge,
      todayRank: region.ranking.todayChallenge,
    })),
    stores: report.stores.map((store) => ({
      id: store.id,
      cumulativeAmount: store.cumulative.amount,
      todayAmount: store.today.amount,
      cumulativeRank: store.ranking.cumulativeChallenge,
      todayRank: store.ranking.todayChallenge,
    })),
  };
}

async function readSnapshots(dir) {
  try {
    const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
    const snapshots = [];
    for (const file of files) {
      try {
        snapshots.push(JSON.parse(await fs.readFile(path.join(dir, file), "utf8")));
      } catch {
        // Ignore a damaged local snapshot and preserve the last usable report.
      }
    }
    return snapshots;
  } catch {
    return [];
  }
}

function rows(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`缺少必需工作表：${sheetName}`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
}

function requireRows(sheetName, data, minimum) {
  if (data.length < minimum) throw new Error(`工作表 ${sheetName} 数据不足`);
}

function mapByName(data) {
  return new Map(data.map((row) => [text(row[0]), row]).filter(([name]) => name && name !== "总计"));
}

function rankMap(data, startIndex) {
  const map = new Map();
  let rank = 1;
  for (const row of data.slice(startIndex)) {
    const name = text(row[0]);
    if (!name || name === "总计") continue;
    map.set(name, rank++);
  }
  return map;
}

function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replaceAll(",", "").replace("%", ""));
    if (Number.isFinite(parsed)) return value.includes("%") ? parsed / 100 : parsed;
  }
  return 0;
}

function rate(value) {
  return number(value);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function ratio(amount, target) {
  return target > 0 ? amount / target : 0;
}

function stableId(prefix, value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
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

function parseArgs(values) {
  const parsed = { input: null, functionalInput: null, generatedAt: null, dryRun: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--input") parsed.input = values[++index];
    else if (value === "--functional-input") parsed.functionalInput = values[++index];
    else if (value === "--generated-at") parsed.generatedAt = values[++index];
    else if (value === "--dry-run") parsed.dryRun = true;
  }
  return parsed;
}
