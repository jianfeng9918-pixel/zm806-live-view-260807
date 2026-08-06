export type ReportMode = "today" | "cumulative";
export type RankKey = "todayChallenge" | "cumulativeChallenge";

export type RankChanges30 = {
  todayChallenge: number | null;
  cumulativeChallenge: number | null;
};

export type RankComparable = {
  id: string;
  name: string;
  ranking: Record<RankKey, number | null>;
  cumulative: {
    amount: number;
    targets: { challenge: number };
  };
  today: {
    amount: number;
    targetAmount: number;
  };
  rankChanges30?: RankChanges30;
  rankChange30?: number | null;
};

export type OvertakeResult = {
  status: "leader" | "available" | "unavailable";
  amount: number | null;
  previousName: string | null;
};

export function rankKeyForMode(mode: ReportMode): RankKey {
  return mode === "today" ? "todayChallenge" : "cumulativeChallenge";
}

export function rankForMode(entity: RankComparable, mode: ReportMode): number | null {
  return entity.ranking[rankKeyForMode(mode)];
}

export function rankChangeForMode(entity: RankComparable, mode: ReportMode): number | null {
  const key = rankKeyForMode(mode);
  if (entity.rankChanges30) return entity.rankChanges30[key];
  return mode === "cumulative" ? entity.rankChange30 ?? null : null;
}

export function rankWithinScope(
  entities: RankComparable[],
  currentId: string,
  mode: ReportMode,
): number | null {
  const key = rankKeyForMode(mode);
  const ordered = entities
    .filter((entity) => entity.ranking[key] != null)
    .sort((a, b) => (a.ranking[key] ?? Number.POSITIVE_INFINITY) - (b.ranking[key] ?? Number.POSITIVE_INFINITY)
      || a.name.localeCompare(b.name, "zh-CN"));
  const index = ordered.findIndex((entity) => entity.id === currentId);
  return index >= 0 ? index + 1 : null;
}

export function calculateOvertakeGap(
  entities: RankComparable[],
  currentId: string,
  mode: ReportMode,
): OvertakeResult {
  const current = entities.find((entity) => entity.id === currentId);
  if (!current) return { status: "unavailable", amount: null, previousName: null };

  const key = rankKeyForMode(mode);
  const currentRank = current.ranking[key];
  if (currentRank === 1) return { status: "leader", amount: 0, previousName: null };
  if (currentRank == null || currentRank < 1) {
    return { status: "unavailable", amount: null, previousName: null };
  }

  const betterRanks = entities
    .map((entity) => entity.ranking[key])
    .filter((rank): rank is number => rank != null && rank < currentRank);
  if (!betterRanks.length) return { status: "unavailable", amount: null, previousName: null };

  const precedingRank = Math.max(...betterRanks);
  const precedingEntities = entities.filter((entity) => entity.ranking[key] === precedingRank);

  const currentAmount = mode === "today" ? current.today.amount : current.cumulative.amount;
  const currentTarget = mode === "today" ? current.today.targetAmount : current.cumulative.targets.challenge;
  const validPrecedingEntities = precedingEntities.filter((entity) => {
    const amount = mode === "today" ? entity.today.amount : entity.cumulative.amount;
    const target = mode === "today" ? entity.today.targetAmount : entity.cumulative.targets.challenge;
    return Number.isFinite(amount) && Number.isFinite(target) && target > 0;
  });
  if (!Number.isFinite(currentAmount) || !Number.isFinite(currentTarget) || currentTarget <= 0 || !validPrecedingEntities.length) {
    return { status: "unavailable", amount: null, previousName: null };
  }

  const previous = validPrecedingEntities.reduce((leader, candidate) => {
    const leaderAmount = mode === "today" ? leader.today.amount : leader.cumulative.amount;
    const leaderTarget = mode === "today" ? leader.today.targetAmount : leader.cumulative.targets.challenge;
    const candidateAmount = mode === "today" ? candidate.today.amount : candidate.cumulative.amount;
    const candidateTarget = mode === "today" ? candidate.today.targetAmount : candidate.cumulative.targets.challenge;
    return candidateAmount / candidateTarget > leaderAmount / leaderTarget ? candidate : leader;
  });
  const previousAmount = mode === "today" ? previous.today.amount : previous.cumulative.amount;
  const previousTarget = mode === "today" ? previous.today.targetAmount : previous.cumulative.targets.challenge;

  // Cross multiplication avoids floating-point drift when the exact threshold is an integer.
  const thresholdNumerator = previousAmount * currentTarget - currentAmount * previousTarget;
  const amount = Math.max(1, Math.floor(thresholdNumerator / previousTarget) + 1);
  return { status: "available", amount, previousName: previous.name };
}
