export function selectCompletedRegionIds(regions) {
  return [...regions]
    .filter((region) => region.today.targetAmount > 0 && region.today.completionRate >= 1)
    .sort((a, b) => b.today.completionRate - a.today.completionRate || a.name.localeCompare(b.name, "zh-CN"))
    .map((region) => region.id);
}

export function selectLowestRegionId(regions) {
  return [...regions]
    .filter((region) => region.today.targetAmount > 0)
    .sort((a, b) => a.today.completionRate - b.today.completionRate || a.name.localeCompare(b.name, "zh-CN"))[0]?.id ?? null;
}

export function selectFastestStoreIds(stores) {
  return [...stores]
    .filter((store) => Number.isFinite(store.delta30))
    .sort((a, b) => b.delta30 - a.delta30
      || b.cumulative.rates.challenge - a.cumulative.rates.challenge
      || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, 3)
    .map((store) => store.id);
}

export function selectAttentionStoreIds(stores, useDelta) {
  return [...stores]
    .filter((store) => store.cumulative.targets.challenge > 0 && store.cumulative.rates.challenge < 1)
    .sort((a, b) => {
      if (useDelta) {
        const deltaA = Number.isFinite(a.delta30) ? a.delta30 : Number.POSITIVE_INFINITY;
        const deltaB = Number.isFinite(b.delta30) ? b.delta30 : Number.POSITIVE_INFINITY;
        if (deltaA !== deltaB) return deltaA - deltaB;
      }
      return a.cumulative.rates.challenge - b.cumulative.rates.challenge
        || a.name.localeCompare(b.name, "zh-CN");
    })
    .slice(0, 3)
    .map((store) => store.id);
}

export function findThirtyMinuteSnapshot(snapshots, timestamp) {
  const current = Date.parse(timestamp);
  return snapshots
    .map((snapshot) => ({ snapshot, ageMinutes: (current - Date.parse(snapshot.generatedAt)) / 60000 }))
    .filter(({ ageMinutes }) => ageMinutes >= 20 && ageMinutes <= 40)
    .sort((a, b) => Math.abs(a.ageMinutes - 30) - Math.abs(b.ageMinutes - 30))[0]?.snapshot ?? null;
}

export function findLatestPriorSnapshot(snapshots, timestamp, maxAgeMinutes = 120) {
  const current = Date.parse(timestamp);
  return snapshots
    .map((snapshot) => ({ snapshot, ageMinutes: (current - Date.parse(snapshot.generatedAt)) / 60000 }))
    .filter(({ ageMinutes }) => ageMinutes > 0 && ageMinutes <= maxAgeMinutes)
    .sort((a, b) => a.ageMinutes - b.ageMinutes)[0]?.snapshot ?? null;
}

export function differenceRate(official, calculated) {
  return official > 0 ? Math.abs(official - calculated) / official : calculated === 0 ? 0 : 1;
}
