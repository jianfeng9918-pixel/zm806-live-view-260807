import assert from "node:assert/strict";
import {
  calculateOvertakeGap,
  rankChangeForMode,
  rankWithinScope,
} from "../src/ranking.ts";

const leader = entity("leader", "上一名", 1, 1, 60, 120, 60, 120);
const challenger = entity("challenger", "当前门店", 2, 2, 40, 100, 50, 100);

assert.deepEqual(
  calculateOvertakeGap([leader, challenger], leader.id, "today"),
  { status: "leader", amount: 0, previousName: null },
  "第一名应进入守榜状态",
);
assert.deepEqual(
  calculateOvertakeGap([leader, challenger], challenger.id, "today"),
  { status: "available", amount: 11, previousName: leader.name },
  "不同目标下应按上一名实际达成率计算反超金额",
);
assert.equal(
  calculateOvertakeGap([leader, challenger], challenger.id, "cumulative").amount,
  1,
  "与上一名达成率相同时必须再多1元",
);

const zeroTarget = entity("zero", "零目标门店", 2, 2, 10, 0, 10, 0);
assert.equal(calculateOvertakeGap([leader, zeroTarget], zeroTarget.id, "today").status, "unavailable");
const missingRank = entity("missing", "无排名门店", null, null, 10, 100, 10, 100);
assert.equal(calculateOvertakeGap([leader, missingRank], missingRank.id, "today").status, "unavailable");

const tiedLeaderA = entity("tied-a", "并列上一名甲", 1, 1, 60, 100, 60, 100);
const tiedLeaderB = entity("tied-b", "并列上一名乙", 1, 1, 65, 100, 65, 100);
const rankAfterTie = entity("after-tie", "并列后的门店", 3, 3, 50, 100, 50, 100);
assert.deepEqual(
  calculateOvertakeGap([tiedLeaderA, tiedLeaderB, rankAfterTie], rankAfterTie.id, "today"),
  { status: "available", amount: 16, previousName: tiedLeaderB.name },
  "BI并列导致排名跳号时，应超过最近更优名次中的最高实际达成率",
);

const regionScope = [
  entity("national-1", "区域店甲", 1, 5, 10, 100, 10, 100),
  entity("national-9", "区域店乙", 9, 8, 10, 100, 10, 100),
  entity("national-20", "区域店丙", 20, 2, 10, 100, 10, 100),
];
assert.equal(rankWithinScope(regionScope, "national-9", "today"), 2, "区域排名应沿用BI全国顺序过滤");
assert.equal(rankWithinScope(regionScope, "national-20", "cumulative"), 1, "今日与累计区域排名应分开计算");

const movement = {
  ...challenger,
  rankChange30: 2,
  rankChanges30: { todayChallenge: -1, cumulativeChallenge: 3 },
};
assert.equal(rankChangeForMode(movement, "today"), -1);
assert.equal(rankChangeForMode(movement, "cumulative"), 3);
assert.equal(rankChangeForMode({ ...challenger, rankChange30: 2 }, "cumulative"), 2, "旧累计字段应保持兼容");
assert.equal(rankChangeForMode({ ...challenger, rankChange30: 2 }, "today"), null, "旧字段不得冒充今日排名变化");

console.log(JSON.stringify({
  status: "passed",
  cases: ["leader", "strict-plus-one", "different-targets", "zero-target", "missing-rank", "tied-rank-gap", "regional-rank", "mode-specific-movement"],
}, null, 2));

function entity(id, name, todayRank, cumulativeRank, todayAmount, todayTarget, cumulativeAmount, cumulativeTarget) {
  return {
    id,
    name,
    ranking: { todayChallenge: todayRank, cumulativeChallenge: cumulativeRank },
    today: { amount: todayAmount, targetAmount: todayTarget },
    cumulative: { amount: cumulativeAmount, targets: { challenge: cumulativeTarget } },
  };
}
