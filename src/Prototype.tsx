import { useEffect, useMemo, useState } from "react";
import {
  BarChartIcon,
  CheckCircledIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  RocketIcon,
  StarFilledIcon,
} from "@radix-ui/react-icons";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { KeyboardInput, MobileScroll, useKeyboard } from "./mobile";
import {
  calculateOvertakeGap,
  rankChangeForMode,
  rankWithinScope,
  type OvertakeResult,
  type RankChanges30,
} from "./ranking";

type Mode = "today" | "cumulative";
type ScopeType = "hq" | "region" | "store";

type SavedViewPreference = {
  version: 1;
  mode: Mode;
  scopeType: ScopeType;
  scopeId: string | null;
};

type TargetSet = { bet: number; drive: number; challenge: number };
type RateSet = { bet: number; drive: number; challenge: number };
type TrendPoint = { at: string; amount: number };
type BonusGoal = { label: string; targetAmount: number; totalBonus: number };

type Store = {
  id: string;
  name: string;
  regionId: string;
  regionName: string;
  status: string | null;
  bonus: number;
  bonusGoal?: BonusGoal;
  tierOrders: { tier388: number; tier688: number; tier1288: number; tier1888: number };
  ranking: { cumulativeChallenge: number | null; todayChallenge: number | null };
  cumulative: {
    amount: number;
    orderCount: number;
    targetOrderCount: number;
    orderCompletionRate: number;
    targets: TargetSet;
    rates: RateSet;
  };
  today: {
    amount: number;
    orderCount: number;
    targetOrderCount: number;
    orderCompletionRate: number;
    targetAmount: number;
    completionRate: number;
  };
  delta30: number | null;
  todayDelta30: number | null;
  rankChange30: number | null;
  rankChanges30?: RankChanges30;
  trend: TrendPoint[];
};

type Region = {
  id: string;
  name: string;
  managerName: string | null;
  storeCount: number;
  bonusGoal?: BonusGoal;
  ranking: { cumulativeChallenge: number | null; todayChallenge: number | null };
  cumulative: {
    amount: number;
    targets: TargetSet;
    rates: RateSet;
    bonus: number;
  };
  today: {
    amount: number;
    orderCount: number;
    targetOrderCount: number;
    orderCompletionRate: number;
    targetAmount: number;
    completionRate: number;
  };
  delta30: number | null;
  todayDelta30: number | null;
  rankChanges30?: RankChanges30;
  trend: TrendPoint[];
};

type Report = {
  schemaVersion: number;
  campaign: string;
  generatedAt: string;
  timezone: string;
  freshness: { status: string; staleAfterMinutes: number; message: string | null };
  source: {
    aggregationVersion: string;
    reconciliation: {
      status: "matched" | "warning";
      cumulative: {
        official: number;
        storeSum: number;
        functionalSum: number;
        combinedSum: number;
        differenceRate: number;
      };
      today: {
        official: number;
        storeSum: number;
        functionalSum: number;
        combinedSum: number;
        differenceRate: number;
      };
    };
  };
  defaults: { scope: ScopeType; mode: Mode; featuredStoreId: string | null };
  hq: {
    storeCount: number;
    activeStoreCount: number;
    bonus: number;
    functional: {
      departmentCount: number;
      cumulative: {
        amount: number;
        orderCount: number;
        targetAmount: number;
        completionRate: number;
      };
      today: { amount: number };
    };
    cumulative: {
      amount: number;
      orderCount: number;
      targetOrderCount: number;
      orderCompletionRate: number;
      targets: TargetSet;
      rates: RateSet;
    };
    today: {
      amount: number;
      orderCount: number;
      targetOrderCount: number;
      orderCompletionRate: number;
      targetAmount: number;
      completionRate: number;
    };
    delta30: number | null;
    todayDelta30: number | null;
    trend: TrendPoint[];
  };
  summary: {
    deltaBasis: string;
    comparisonMinutes: number | null;
    comparisonFrom: string | null;
    fastestStoreIds: string[];
    attentionStoreIds: string[];
    completedRegionIds: string[];
    lowestRegionId: string | null;
    noGrowthStoreCount: number | null;
    noGrowthRegionCount: number | null;
  };
  regions: Region[];
  stores: Store[];
};

const currency = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const VIEW_PREFERENCE_KEY = "zhoumapo-806-report-view-v1";

export default function Prototype() {
  const [report, setReport] = useState<Report | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("today");
  const [scopeType, setScopeType] = useState<ScopeType>("hq");
  const [scopeId, setScopeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let hasLoaded = false;

    const loadLatestReport = () => {
      fetch(`${import.meta.env.BASE_URL}data/report.json?ts=${Date.now()}`, { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error(`数据读取失败（${response.status}）`);
          return response.json() as Promise<Report>;
        })
        .then((payload) => {
          if (cancelled) return;
          if (!hasLoaded) {
            const preference = readViewPreference(payload);
            setMode(preference.mode);
            setScopeType(preference.scopeType);
            setScopeId(preference.scopeId);
          }
          hasLoaded = true;
          setLoadError(null);
          setReport(payload);
        })
        .catch((error: Error) => {
          if (!cancelled && !hasLoaded) setLoadError(error.message);
        });
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadLatestReport();
    };

    loadLatestReport();
    const refreshTimer = window.setInterval(loadLatestReport, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (!report) return;
    writeViewPreference({ version: 1, mode, scopeType, scopeId });
  }, [mode, report, scopeId, scopeType]);

  const navigate = (type: ScopeType, id: string | null = null) => {
    setScopeType(type);
    setScopeId(id);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="mobile-scroll"]')?.scrollTo({ top: 0 });
    });
  };

  return (
    <MobileScroll className="app-screen">
      <main
        className="report-app"
        data-testid="report-app"
        onContextMenu={(event) => event.preventDefault()}
      >
        {!report && !loadError ? <LoadingState /> : null}
        {loadError ? <ErrorState message={loadError} /> : null}
        {report ? (
          <>
            <ReportHeader report={report} />
            <ScopeControls
              report={report}
              mode={mode}
              scopeType={scopeType}
              scopeId={scopeId}
              onModeChange={setMode}
              onNavigate={navigate}
            />
            {report.source.reconciliation.status === "warning" ? (
              <div className="data-warning" role="status">
                <ExclamationTriangleIcon /> BI集团汇总与门店端＋职能端分项存在差异，请核对两次导出时间。
              </div>
            ) : null}
            {scopeType === "hq" ? (
              <HeadquartersView report={report} mode={mode} onNavigate={navigate} />
            ) : null}
            {scopeType === "region" ? (
              <RegionView
                report={report}
                region={report.regions.find((region) => region.id === scopeId) ?? report.regions[0]}
                mode={mode}
                onNavigate={navigate}
              />
            ) : null}
            {scopeType === "store" ? (
              <StoreView
                report={report}
                store={report.stores.find((store) => store.id === scopeId)
                  ?? report.stores.find((store) => store.id === report.defaults.featuredStoreId)
                  ?? report.stores[0]}
                mode={mode}
                onNavigate={navigate}
              />
            ) : null}
            <footer className="report-footer">
              <span>V1人工更新 · 建议每30分钟一次</span>
              <span>内部查看 · 不提供导出</span>
            </footer>
          </>
        ) : null}
      </main>
    </MobileScroll>
  );
}

function ReportHeader({ report }: { report: Report }) {
  const age = Date.now() - Date.parse(report.generatedAt);
  const stale = age > report.freshness.staleAfterMinutes * 60_000;
  return (
    <header className="report-header">
      <div className="brand-line">
        <img src={`${import.meta.env.BASE_URL}brand/logo-zhoumapo.png`} alt="周麻婆 川式小炒" />
        <div className="campaign-title">
          <h1>14周年 806储值战报</h1>
          <p className={stale ? "update-line stale" : "update-line"}>
            <span className="status-dot" />
            {formatTime(report.generatedAt)}更新
            <span aria-hidden="true">·</span>
            {stale ? "数据已延迟" : "V1人工更新"}
          </p>
        </div>
        <span className="readonly-mark">内部只读</span>
      </div>
    </header>
  );
}

function ScopeControls({
  report,
  mode,
  scopeType,
  scopeId,
  onModeChange,
  onNavigate,
}: {
  report: Report;
  mode: Mode;
  scopeType: ScopeType;
  scopeId: string | null;
  onModeChange: (mode: Mode) => void;
  onNavigate: (type: ScopeType, id: string | null) => void;
}) {
  const activeStore = scopeType === "store"
    ? report.stores.find((store) => store.id === scopeId) ?? null
    : null;
  const selectedRegionId = scopeType === "region"
    ? scopeId
    : activeStore?.regionId ?? null;
  const selectedRegion = report.regions.find((region) => region.id === selectedRegionId) ?? null;
  const regionStores = selectedRegion
    ? report.stores.filter((store) => store.regionId === selectedRegion.id)
    : [];
  const primaryValue = selectedRegion?.id ?? "hq";
  const secondaryValue = activeStore?.id ?? "region-overview";
  const activeLabel = activeStore?.name ?? selectedRegion?.name ?? "总部总览";

  return (
    <section className="scope-panel" aria-label="战报筛选">
      <div className="scope-panel-heading">
        <p><span>正在查看</span><strong>{activeLabel}</strong></p>
        <span>本机已记住</span>
      </div>

      <div className={selectedRegion ? "scope-select-grid has-secondary" : "scope-select-grid"}>
        <div className="select-shell primary-select">
          <select
            id="primary-scope-select"
            aria-label="1 先选择总部或区域"
            value={primaryValue}
            onChange={(event) => {
              if (event.target.value === "hq") onNavigate("hq", null);
              else onNavigate("region", event.target.value);
            }}
          >
            <option value="hq">总部总览</option>
            <optgroup label="选择区域">
              {report.regions.map((region) => (
                <option key={region.id} value={region.id}>{region.name}</option>
              ))}
            </optgroup>
          </select>
          <ChevronDownIcon aria-hidden="true" />
        </div>

        {selectedRegion ? (
          <div className="select-shell secondary-select">
            <select
              id="store-scope-select"
              aria-label="2 再选择区域总览或门店"
              value={secondaryValue}
              onChange={(event) => {
                if (event.target.value === "region-overview") onNavigate("region", selectedRegion.id);
                else onNavigate("store", event.target.value);
              }}
            >
              <option value="region-overview">{selectedRegion.name} · 区域总览</option>
              <optgroup label={`${selectedRegion.name}门店`}>
                {regionStores.map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </optgroup>
            </select>
            <ChevronDownIcon aria-hidden="true" />
          </div>
        ) : null}
      </div>

      <div className="mode-panel">
        <strong className="mode-label">口径</strong>
        <div className="mode-switch" role="tablist" aria-label="数据口径">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "today"}
            className={mode === "today" ? "active" : ""}
            onClick={() => onModeChange("today")}
          >
            <span>今日</span>
            <small>当天</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "cumulative"}
            className={mode === "cumulative" ? "active" : ""}
            onClick={() => onModeChange("cumulative")}
          >
            <span>累计</span>
            <small>806总进度</small>
          </button>
        </div>
      </div>
    </section>
  );
}

function HeadquartersView({ report, mode, onNavigate }: {
  report: Report;
  mode: Mode;
  onNavigate: (type: ScopeType, id: string | null) => void;
}) {
  const metric = mode === "today" ? report.hq.today : report.hq.cumulative;
  const amount = metric.amount;
  const completion = mode === "today" ? report.hq.today.completionRate : report.hq.cumulative.rates.challenge;
  const target = mode === "today" ? report.hq.today.targetAmount : report.hq.cumulative.targets.challenge;
  const delta = mode === "today" ? report.hq.todayDelta30 : report.hq.delta30;
  const deltaLabel = comparisonWindowLabel(report.summary);

  return (
    <>
      <section className="hero-card hq-hero">
        <div className="hero-heading">
          <div>
            <p className="eyebrow">全品牌 · {mode === "today" ? "今日战况" : "累计战况"}</p>
            <strong className="hero-amount">¥ {money(amount)}</strong>
            <span className="hero-caption">储值金额</span>
          </div>
          <div className="hero-rate">
            <strong>{percent(completion)}</strong>
            <span>挑战目标达成率</span>
          </div>
        </div>
        <div className="hq-kpis">
          <Kpi label={deltaLabel} value={signedMoney(delta)} tone={delta == null || delta >= 0 ? "green" : "red"} />
          <Kpi label="参与门店" value={`${report.hq.activeStoreCount}/${report.hq.storeCount}家`} />
          <Kpi label="距离目标" value={`¥${money(Math.max(target - amount, 0))}`} />
        </div>
      </section>

      <RegionAchievement report={report} onNavigate={onNavigate} />
      <BattleBoards report={report} scopeStores={report.stores} onNavigate={onNavigate} />
      <TrendSection title="全品牌储值趋势" points={report.hq.trend} />
      <StoreDirectory report={report} stores={report.stores} mode={mode} />
    </>
  );
}

function RegionAchievement({ report, onNavigate }: {
  report: Report;
  onNavigate: (type: ScopeType, id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const completed = report.regions.filter((region) => report.summary.completedRegionIds.includes(region.id));
  const lowest = report.regions.find((region) => region.id === report.summary.lowestRegionId) ?? null;
  const ranked = [...report.regions].sort((a, b) => b.today.completionRate - a.today.completionRate);
  const visible = expanded ? ranked : ranked.slice(0, 6);
  const noGrowth = report.summary.noGrowthRegionCount;
  const deltaLabel = comparisonWindowLabel(report.summary);

  return (
    <section className="section-block region-achievement" data-testid="region-achievement">
      <div className="section-title-row">
        <div>
          <h2>区域今日达成率</h2>
          <p>总部督促区域经理的核心看板</p>
        </div>
        <span className="fixed-today">固定今日</span>
      </div>
      <div className="management-summary">
        <BarChartIcon />
        <p>
          已达标 <strong>{completed.length}</strong> 个区域；最低为 <strong>{lowest?.name ?? "—"}</strong>；
          还差 <strong>¥{money(lowest ? Math.max(lowest.today.targetAmount - lowest.today.amount, 0) : 0)}</strong>；
          {deltaLabel}无增长 <strong>{noGrowth == null ? "待下次快照" : `${noGrowth}个区域`}</strong>。
        </p>
      </div>
      <div className="region-callouts">
        <div className="completed-card">
          <div className="callout-label"><CheckCircledIcon /> 今日已达标</div>
          {completed.length ? completed.map((region) => (
            <button key={region.id} type="button" onClick={() => onNavigate("region", region.id)}>
              <span>{region.name}</span><strong>{percent(region.today.completionRate)}</strong>
            </button>
          )) : <p>暂时还没有区域完成今日目标</p>}
        </div>
        <div className="lowest-card">
          <div className="callout-label"><ExclamationTriangleIcon /> 当前最低</div>
          <button type="button" onClick={() => lowest && onNavigate("region", lowest.id)}>
            <span>{lowest?.name ?? "—"}</span>
            <strong>{percent(lowest?.today.completionRate ?? 0)}</strong>
            <small>差额 ¥{money(lowest ? Math.max(lowest.today.targetAmount - lowest.today.amount, 0) : 0)}</small>
          </button>
        </div>
      </div>
      <div className="region-ranking">
        <div className="list-heading">
          <span>排名 / 区域</span><span>今日金额</span><span>达成率</span>
        </div>
        {visible.map((region, index) => (
          <button key={region.id} type="button" className="region-row" onClick={() => onNavigate("region", region.id)}>
            <span className="rank-number">{index + 1}</span>
            <span className="row-main"><strong>{region.name}</strong><small>{region.storeCount}家门店</small></span>
            <span className="money-cell">¥{money(region.today.amount)}</span>
            <span className={region.today.completionRate >= 1 ? "rate-cell achieved" : "rate-cell"}>
              {percent(region.today.completionRate)}<ChevronRightIcon />
            </span>
          </button>
        ))}
      </div>
      {ranked.length > 6 ? (
        <button type="button" className="text-button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起区域" : `查看全部${ranked.length}个区域`}
          <ChevronDownIcon className={expanded ? "rotated" : ""} />
        </button>
      ) : null}
    </section>
  );
}

function RegionView({ report, region, mode, onNavigate }: {
  report: Report;
  region: Region;
  mode: Mode;
  onNavigate: (type: ScopeType, id: string | null) => void;
}) {
  const stores = report.stores.filter((store) => store.regionId === region.id);
  const amount = mode === "today" ? region.today.amount : region.cumulative.amount;
  const target = mode === "today" ? region.today.targetAmount : region.cumulative.targets.challenge;
  const completion = mode === "today" ? region.today.completionRate : region.cumulative.rates.challenge;
  const rank = mode === "today" ? region.ranking.todayChallenge : region.ranking.cumulativeChallenge;
  const delta = mode === "today" ? region.todayDelta30 : region.delta30;
  const deltaLabel = comparisonWindowLabel(report.summary);
  const rankChange = rankChangeForMode(region, mode);
  const overtake = calculateOvertakeGap(report.regions, region.id, mode);
  const championLabels = regionChampionLabels(region);
  const rankComparison = rankingComparisonText(region.ranking.todayChallenge, region.ranking.cumulativeChallenge);

  return (
    <>
      <section className={`hero-card entity-hero${championLabels.length ? " champion-hero" : ""}`}>
        {championLabels.length ? <ChampionWatermark /> : null}
        <ChampionStrip labels={championLabels} />
        <p className="eyebrow">区域视角 · {mode === "today" ? "今日" : "累计"}</p>
        <div className="entity-heading">
          <div><h2>{region.name}</h2><span className="region-tag">{region.storeCount}家门店</span></div>
          <div className={rank === 1 ? "rank-display rank-leader" : "rank-display"}>第<strong>{rank ?? "—"}</strong>名<small>/{report.regions.length}区</small></div>
        </div>
        <div className="hero-heading compact">
          <div><strong className="hero-amount">¥ {money(amount)}</strong><span className="hero-caption">储值金额</span></div>
          <div className="hero-rate"><strong>{percent(completion)}</strong><span>挑战目标达成率</span></div>
        </div>
        <div className="hq-kpis">
          <Kpi label={deltaLabel} value={signedMoney(delta)} tone={delta == null || delta >= 0 ? "green" : "red"} />
          <Kpi label="目标" value={`¥${money(target)}`} />
          <Kpi label="目标差额" value={`¥${money(Math.max(target - amount, 0))}`} />
        </div>
        <MotivationCard
          championLabels={championLabels}
          rank={rank}
          rankChange={rankChange}
          overtake={overtake}
          overtakeLabel="上一名区域"
          rankComparison={rankComparison}
          deltaLabel={deltaLabel}
          delta={delta}
        />
      </section>
      {mode === "cumulative" ? (
        <TargetProgressGrid amount={region.cumulative.amount} targets={region.cumulative.targets} rates={region.cumulative.rates} bonus={region.cumulative.bonus} bonusGoal={region.bonusGoal} />
      ) : null}
      <TrendSection title={`${region.name}储值趋势`} points={region.trend} />
      <BattleBoards report={report} scopeStores={stores} onNavigate={onNavigate} />
      <StoreDirectory report={report} stores={stores} mode={mode} title={`${region.name}门店`} />
    </>
  );
}

function StoreView({ report, store, mode, onNavigate }: {
  report: Report;
  store: Store;
  mode: Mode;
  onNavigate: (type: ScopeType, id: string | null) => void;
}) {
  const amount = mode === "today" ? store.today.amount : store.cumulative.amount;
  const rank = mode === "today" ? store.ranking.todayChallenge : store.ranking.cumulativeChallenge;
  const delta = mode === "today" ? store.todayDelta30 : store.delta30;
  const target = mode === "today" ? store.today.targetAmount : store.cumulative.targets.challenge;
  const deltaLabel = comparisonWindowLabel(report.summary);
  const regionStores = report.stores.filter((candidate) => candidate.regionId === store.regionId);
  const regionalTodayRank = rankWithinScope(regionStores, store.id, "today");
  const regionalCumulativeRank = rankWithinScope(regionStores, store.id, "cumulative");
  const regionalRank = mode === "today" ? regionalTodayRank : regionalCumulativeRank;
  const rankChange = rankChangeForMode(store, mode);
  const overtake = calculateOvertakeGap(report.stores, store.id, mode);
  const championLabels = storeChampionLabels(store, regionalTodayRank, regionalCumulativeRank);
  const rankComparison = rankingComparisonText(store.ranking.todayChallenge, store.ranking.cumulativeChallenge);

  return (
    <>
      <section className={`store-hero entity-hero${championLabels.length ? " champion-hero" : ""}`}>
        {championLabels.length ? <ChampionWatermark /> : null}
        <ChampionStrip labels={championLabels} />
        <div className="entity-heading">
          <div><h2>{store.name}</h2><button type="button" className="region-tag" onClick={() => onNavigate("region", store.regionId)}>{store.regionName}</button></div>
        </div>
        <div className="store-score">
          <div>
            <strong className="hero-amount">¥ {money(amount)}</strong>
            <span className="hero-caption">{mode === "today" ? "今日" : "累计"}储值金额</span>
          </div>
          <div className={rank === 1 ? "rank-display large rank-leader" : "rank-display large"}>
            <div>第<strong>{rank ?? "—"}</strong>名<small>/{report.hq.storeCount}家</small></div>
            <span className="regional-rank-note">本区域第{regionalRank ?? "—"}名</span>
          </div>
        </div>
        <MotivationCard
          championLabels={championLabels}
          rank={rank}
          rankChange={rankChange}
          overtake={overtake}
          overtakeLabel="全国上一名"
          rankComparison={rankComparison}
          deltaLabel={deltaLabel}
          delta={delta}
        />
      </section>

      <TargetProgressGrid amount={store.cumulative.amount} targets={store.cumulative.targets} rates={store.cumulative.rates} bonus={store.bonus} bonusGoal={store.bonusGoal} />

      {mode === "today" ? (
        <section className="single-target-card">
          <div><span>今日挑战目标</span><strong>{percent(store.today.completionRate)}</strong></div>
          <progress max="1" value={Math.min(store.today.completionRate, 1)} />
          <p>已完成 ¥{money(store.today.amount)}，目标 ¥{money(store.today.targetAmount)}，还差 ¥{money(Math.max(target - amount, 0))}</p>
        </section>
      ) : null}

      <TrendSection title="近2小时储值走势" points={store.trend} comparison="本时段增长与区域同步" />
      <BattleBoards report={report} scopeStores={report.stores} onNavigate={onNavigate} compact />
      <StoreDetails store={store} mode={mode} />
      <StoreDirectory report={report} stores={report.stores} mode={mode} selectedStoreId={store.id} />
    </>
  );
}

function ChampionStrip({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <div className="champion-strip" aria-label={`冠军头衔：${labels.join("、")}`}>
      <span className="champion-emblem"><StarFilledIcon /><b>冠军</b></span>
      {labels.map((label) => (
        <span className="champion-badge" key={label}>{label}</span>
      ))}
    </div>
  );
}

function ChampionWatermark() {
  return (
    <img
      className="champion-watermark"
      src={`${import.meta.env.BASE_URL}brand/logo-zhoumapo.png`}
      alt=""
      aria-hidden="true"
    />
  );
}

function MotivationCard({
  championLabels,
  rank,
  rankChange,
  overtake,
  overtakeLabel,
  rankComparison,
  deltaLabel,
  delta,
}: {
  championLabels: string[];
  rank: number | null;
  rankChange: number | null;
  overtake: OvertakeResult;
  overtakeLabel: string;
  rankComparison: string | null;
  deltaLabel: string;
  delta: number | null;
}) {
  const movement = rankMovementLabel(rankChange);
  const tone = rankChange == null || rankChange === 0 ? "steady" : rankChange > 0 ? "rising" : "falling";
  const primary = rank === 1
    ? "当前领先，守住第1"
    : overtake.status === "available" && overtake.amount != null
      ? `再储值 ¥${money(overtake.amount)} 即可超越${overtakeLabel}`
      : "暂时无法计算反超金额";

  return (
    <div className={`motivation-card ${championLabels.length ? "champion" : tone}`} role="status">
      <div className="motivation-main">
        <strong>{primary}</strong>
        <span className={`movement-pill ${tone}`}>{movement}</span>
      </div>
      {rankComparison ? <p>{rankComparison}</p> : null}
      <small>{deltaLabel}储值变化 {signedMoney(delta)}</small>
    </div>
  );
}

function regionChampionLabels(region: Region) {
  const labels: string[] = [];
  if (region.ranking.todayChallenge === 1) labels.push("全国区域今日冠军");
  if (region.ranking.cumulativeChallenge === 1) labels.push("全国区域累计冠军");
  return labels;
}

function storeChampionLabels(store: Store, regionalTodayRank: number | null, regionalCumulativeRank: number | null) {
  const labels: string[] = [];
  if (store.ranking.todayChallenge === 1) labels.push("全国今日冠军");
  else if (regionalTodayRank === 1) labels.push(`${store.regionName}今日冠军`);
  if (store.ranking.cumulativeChallenge === 1) labels.push("全国累计冠军");
  else if (regionalCumulativeRank === 1) labels.push(`${store.regionName}累计冠军`);
  return labels;
}

function rankMovementLabel(rankChange: number | null) {
  if (rankChange == null) return "待下次快照";
  if (rankChange > 0) return `上升${rankChange}名 · 势头正好`;
  if (rankChange < 0) return `下降${Math.abs(rankChange)}名 · 稳住节奏`;
  return "排名暂稳";
}

function rankingComparisonText(todayRank: number | null, cumulativeRank: number | null) {
  if (todayRank == null || cumulativeRank == null) return null;
  if (todayRank < cumulativeRank) return `今日比总进度领先${cumulativeRank - todayRank}名 · 保持节奏`;
  if (todayRank > cumulativeRank) return `今日比总进度落后${todayRank - cumulativeRank}名 · 下一名就在前面`;
  return "今日与总进度排名持平";
}

function TargetProgressGrid({ amount, targets, rates, bonus, bonusGoal }: {
  amount: number;
  targets: TargetSet;
  rates: RateSet;
  bonus: number;
  bonusGoal?: BonusGoal;
}) {
  const items = [
    { key: "bet", label: "对赌目标", target: targets.bet, value: rates.bet },
    { key: "drive", label: "拼搏目标", target: targets.drive, value: rates.drive },
    { key: "challenge", label: "挑战目标", target: targets.challenge, value: rates.challenge },
  ] as const;
  return (
    <section className="target-section">
      <div className="target-grid">
        {items.map((item) => (
          <div className={`target-item ${item.key}`} key={item.key}>
            <span>{item.label}</span>
            <strong>{percent(item.value)}</strong>
            <small>目标 ¥{money(item.target)}</small>
            <progress max="1" value={Math.min(item.value, 1)} aria-label={`${item.label}${percent(item.value)}`} />
          </div>
        ))}
      </div>
      <BonusGoalSummary amount={amount} challengeTarget={targets.challenge} currentBonus={bonus} bonusGoal={bonusGoal} />
    </section>
  );
}

function BonusGoalSummary({ amount, challengeTarget, currentBonus, bonusGoal }: {
  amount: number;
  challengeTarget: number;
  currentBonus: number;
  bonusGoal?: BonusGoal;
}) {
  const targetAmount = bonusGoal && Number.isFinite(bonusGoal.targetAmount) && bonusGoal.targetAmount > 0
    ? bonusGoal.targetAmount
    : challengeTarget;
  const gap = Math.max(Math.ceil(targetAmount - amount), 0);
  const hasOfficialBonusGoal = Boolean(
    bonusGoal
    && Number.isFinite(bonusGoal.totalBonus)
    && bonusGoal.totalBonus >= currentBonus,
  );
  const remainingBonus = hasOfficialBonusGoal ? Math.max((bonusGoal?.totalBonus ?? 0) - currentBonus, 0) : null;

  return (
    <div className="bonus-goal-card">
      <div className="bonus-earned">
        <span>已获得奖金</span>
        <strong>¥{money(currentBonus)}</strong>
      </div>
      <div className="bonus-goal-copy">
        <span>{bonusGoal?.label ?? "冲刺挑战目标"}</span>
        <strong>
          {hasOfficialBonusGoal
            ? `总计可拿 ¥${money(bonusGoal?.totalBonus ?? 0)}`
            : gap > 0 ? `还差 ¥${money(gap)}` : "目标已完成"}
        </strong>
        <small>
          {hasOfficialBonusGoal
            ? remainingBonus && remainingBonus > 0 ? `奖金还可增加 ¥${money(remainingBonus)} · 再储值 ¥${money(gap)}` : "奖金目标已完成"
            : "总奖金按实际储值档位实时累计"}
        </small>
      </div>
    </div>
  );
}

function TrendSection({ title, points, comparison }: { title: string; points: TrendPoint[]; comparison?: string }) {
  const chartData = points.map((point) => ({
    ...point,
    label: formatTime(point.at),
  }));
  return (
    <section className="section-block trend-section">
      <div className="section-title-row compact-title">
        <h2>{title}</h2>
        <span className="positive-note">{comparison ?? "随每次快照更新"}</span>
      </div>
      {chartData.length >= 2 ? (
        <div className="chart-wrap" aria-label={title}>
          <ResponsiveContainer width="100%" height={148}>
            <LineChart data={chartData} margin={{ top: 14, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="label" axisLine={{ stroke: "#a8afb8" }} tickLine={false} tick={{ fill: "#69717d", fontSize: 11 }} />
              <YAxis domain={["dataMin - 1000", "dataMax + 1000"]} tickFormatter={compactMoney} axisLine={false} tickLine={false} tick={{ fill: "#69717d", fontSize: 10 }} width={54} />
              <Tooltip formatter={(value) => [`¥${money(Number(value))}`, "储值金额"]} labelFormatter={(label) => `${label}快照`} />
              <Line type="monotone" dataKey="amount" stroke="#ef3f23" strokeWidth={2.5} dot={{ r: 4, fill: "#ef3f23", strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="trend-empty">
          <ClockIcon />
          <div><strong>首轮快照已建立</strong><span>下一次更新后生成30分钟趋势</span></div>
          {chartData[0] ? <b>¥{money(chartData[0].amount)}</b> : null}
        </div>
      )}
    </section>
  );
}

function BattleBoards({ report, scopeStores, onNavigate, compact = false }: {
  report: Report;
  scopeStores: Store[];
  onNavigate: (type: ScopeType, id: string | null) => void;
  compact?: boolean;
}) {
  const deltaLabel = comparisonWindowLabel(report.summary);
  const scopeIds = new Set(scopeStores.map((store) => store.id));
  const summaryFastest = report.summary.fastestStoreIds
    .map((id) => report.stores.find((store) => store.id === id))
    .filter((store): store is Store => Boolean(store && scopeIds.has(store.id)))
    .slice(0, 3);
  const fastest = summaryFastest.length ? summaryFastest : [...scopeStores]
    .filter((store) => store.delta30 != null)
    .sort((a, b) => (b.delta30 ?? 0) - (a.delta30 ?? 0))
    .slice(0, 3);
  const summaryAttention = report.summary.attentionStoreIds
    .map((id) => report.stores.find((store) => store.id === id))
    .filter((store): store is Store => Boolean(store && scopeIds.has(store.id)))
    .slice(0, 3);
  const attention = summaryAttention.length ? summaryAttention : [...scopeStores]
    .filter((store) => store.cumulative.targets.challenge > 0 && store.cumulative.rates.challenge < 1)
    .sort((a, b) => (a.delta30 ?? 0) - (b.delta30 ?? 0) || a.cumulative.rates.challenge - b.cumulative.rates.challenge)
    .slice(0, 3);

  return (
    <section className={compact ? "section-block battle-section compact-battle" : "section-block battle-section"}>
      <div className="section-title-row compact-title">
        <h2>总部战况 <span>· {deltaLabel}</span></h2>
        <span className="today-total">全品牌今日储值 ¥{money(report.hq.today.amount)}</span>
      </div>
      <div className="battle-grid">
        <div className="battle-column fastest">
          <h3><RocketIcon /> 冲刺最快 TOP 3</h3>
          {fastest.length ? fastest.map((store, index) => (
            <button key={store.id} type="button" onClick={() => onNavigate("store", store.id)}>
              <b>{index + 1}</b><span>{store.name}</span><strong>{signedMoney(store.delta30)}</strong>
            </button>
          )) : (
            <div className="waiting-delta"><ClockIcon /><span>等待下一次人工更新</span></div>
          )}
        </div>
        <div className="battle-column attention">
          <h3><ExclamationTriangleIcon /> 需要关注 {attention.length}家</h3>
          {attention.map((store) => (
            <button key={store.id} type="button" onClick={() => onNavigate("store", store.id)}>
              <span>{store.name}</span><strong>{signedMoney(store.delta30)}</strong>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function StoreDetails({ store, mode }: { store: Store; mode: Mode }) {
  const rows = mode === "today" ? [
    ["储值单量", `${store.today.orderCount} / ${money(store.today.targetOrderCount)}`],
    ["今日目标", `¥${money(store.today.targetAmount)}`],
    ["距离今日目标", `¥${money(Math.max(store.today.targetAmount - store.today.amount, 0))}`],
    ["单量达成率", percent(store.today.orderCompletionRate)],
  ] : [
    ["储值单量", `${store.cumulative.orderCount} / ${money(store.cumulative.targetOrderCount)}`],
    ["距离对赌目标", `¥${money(Math.max(store.cumulative.targets.bet - store.cumulative.amount, 0))}`],
    ["距离拼搏目标", `¥${money(Math.max(store.cumulative.targets.drive - store.cumulative.amount, 0))}`],
    ["距离挑战目标", `¥${money(Math.max(store.cumulative.targets.challenge - store.cumulative.amount, 0))}`],
    ["奖金档位明细", `388×${store.tierOrders.tier388} · 688×${store.tierOrders.tier688} · 1288×${store.tierOrders.tier1288} · 1888×${store.tierOrders.tier1888}`],
  ];
  return (
    <section className="section-block detail-section">
      <h2>门店详细数据</h2>
      <div className="detail-list">
        {rows.map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>
    </section>
  );
}

function StoreDirectory({ report, stores, mode, title = "全部门店", selectedStoreId }: {
  report: Report;
  stores: Store[];
  mode: Mode;
  title?: string;
  selectedStoreId?: string;
}) {
  const keyboard = useKeyboard();
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"challenge" | "amount" | "delta">("challenge");
  const [expanded, setExpanded] = useState(false);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const result = stores.filter((store) => !term || `${store.name}${store.regionName}`.toLowerCase().includes(term));
    return result.sort((a, b) => {
      if (sortBy === "amount") return metricAmount(b, mode) - metricAmount(a, mode);
      if (sortBy === "delta") return (metricDelta(b, mode) ?? -Infinity) - (metricDelta(a, mode) ?? -Infinity);
      return metricCompletion(b, mode) - metricCompletion(a, mode);
    });
  }, [mode, query, sortBy, stores]);
  const visible = expanded || query ? filtered : filtered.slice(0, 12);

  return (
    <section className="section-block store-directory">
      <div className="directory-title">
        <h2>{title}</h2>
        <div className="sort-shell">
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} aria-label="门店排序">
            <option value="challenge">按挑战目标达成率</option>
            <option value="amount">按储值金额</option>
            <option value="delta">按{comparisonWindowLabel(report.summary)}增量</option>
          </select>
          <ChevronDownIcon />
        </div>
      </div>
      <p className="directory-readonly-note">总表仅供浏览 · 切换门店请使用上方选择框</p>
      <label className="search-box" htmlFor={`store-search-${title}`}>
        <MagnifyingGlassIcon />
        <KeyboardInput
          id={`store-search-${title}`}
          value={query}
          placeholder="搜索门店或区域"
          onChange={(event) => setQuery(event.target.value)}
          onBlur={() => window.setTimeout(() => keyboard.hide(), 0)}
        />
      </label>
      <div className="store-table-heading"><span>排名 / 门店名称</span><span>区域</span><span>储值金额</span><span>达成率</span></div>
      <div className="store-rows">
        {visible.map((store) => {
          const rank = mode === "today" ? store.ranking.todayChallenge : store.ranking.cumulativeChallenge;
          return (
            <div
              key={store.id}
              className={store.id === selectedStoreId ? "store-row selected" : "store-row"}
              aria-current={store.id === selectedStoreId ? "true" : undefined}
            >
              <span className={rank && rank <= 3 ? `rank-badge top-${rank}` : "rank-badge"}>{rank ?? "—"}</span>
              <span className="row-main"><strong>{store.name}</strong><small>{signedMoney(metricDelta(store, mode))}</small></span>
              <span className="region-cell">{store.regionName}</span>
              <span className="money-cell">¥{money(metricAmount(store, mode))}</span>
              <span className="rate-cell">{percent(metricCompletion(store, mode))}</span>
            </div>
          );
        })}
      </div>
      {!visible.length ? <div className="empty-search">没有找到匹配门店</div> : null}
      {!query && filtered.length > 12 ? (
        <button type="button" className="text-button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起门店" : `查看全部${filtered.length}家门店`}<ChevronDownIcon className={expanded ? "rotated" : ""} />
        </button>
      ) : null}
      <p className="directory-note">当前共 {stores.length} 家门店 · 全品牌 {report.hq.storeCount} 家</p>
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  return <div className="kpi"><span>{label}</span><strong className={tone ? tone : ""}>{value}</strong></div>;
}

function LoadingState() {
  return <div className="state-panel"><ClockIcon /><strong>正在读取806战报</strong><span>同步总部、区域与131家门店数据</span></div>;
}

function ErrorState({ message }: { message: string }) {
  return <div className="state-panel error"><ExclamationTriangleIcon /><strong>战报暂时无法打开</strong><span>{message}</span></div>;
}

function metricAmount(store: Store, mode: Mode) {
  return mode === "today" ? store.today.amount : store.cumulative.amount;
}

function metricCompletion(store: Store, mode: Mode) {
  return mode === "today" ? store.today.completionRate : store.cumulative.rates.challenge;
}

function metricDelta(store: Store, mode: Mode) {
  return mode === "today" ? store.todayDelta30 : store.delta30;
}

function money(value: number) {
  return currency.format(Math.round(value || 0));
}

function signedMoney(value: number | null) {
  if (value == null) return "待下次快照";
  if (value === 0) return "±¥0";
  return `${value > 0 ? "+" : "−"}¥${money(Math.abs(value))}`;
}

function comparisonWindowLabel(summary: Report["summary"]) {
  if (summary.comparisonMinutes == null) return "近30分钟";
  if (summary.comparisonMinutes >= 20 && summary.comparisonMinutes <= 40) return "近30分钟";
  return `近${Math.round(summary.comparisonMinutes)}分钟`;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function compactMoney(value: number) {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return money(value);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function readViewPreference(report: Report): SavedViewPreference {
  const fallbackScopeId = report.defaults.scope === "store"
    ? report.defaults.featuredStoreId
    : null;
  const fallback: SavedViewPreference = {
    version: 1,
    mode: report.defaults.mode,
    scopeType: report.defaults.scope,
    scopeId: fallbackScopeId,
  };

  try {
    const raw = window.localStorage.getItem(VIEW_PREFERENCE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<SavedViewPreference>;
    const savedMode: Mode = saved.mode === "cumulative" || saved.mode === "today"
      ? saved.mode
      : fallback.mode;

    if (saved.scopeType === "hq") {
      return { version: 1, mode: savedMode, scopeType: "hq", scopeId: null };
    }
    if (saved.scopeType === "region" && report.regions.some((region) => region.id === saved.scopeId)) {
      return { version: 1, mode: savedMode, scopeType: "region", scopeId: saved.scopeId ?? null };
    }
    if (saved.scopeType === "store" && report.stores.some((store) => store.id === saved.scopeId)) {
      return { version: 1, mode: savedMode, scopeType: "store", scopeId: saved.scopeId ?? null };
    }
  } catch {
    // Private browsing and locked-down WebViews can reject storage access.
  }

  return { ...fallback, mode: fallback.mode };
}

function writeViewPreference(preference: SavedViewPreference) {
  try {
    window.localStorage.setItem(VIEW_PREFERENCE_KEY, JSON.stringify(preference));
  } catch {
    // The report remains fully usable when device-local storage is unavailable.
  }
}
