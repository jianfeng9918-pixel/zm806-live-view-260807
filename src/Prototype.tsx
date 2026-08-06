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

type Mode = "today" | "cumulative";
type ScopeType = "hq" | "region" | "store";

type TargetSet = { bet: number; drive: number; challenge: number };
type RateSet = { bet: number; drive: number; challenge: number };
type TrendPoint = { at: string; amount: number };

type Store = {
  id: string;
  name: string;
  regionId: string;
  regionName: string;
  status: string | null;
  bonus: number;
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
  trend: TrendPoint[];
};

type Region = {
  id: string;
  name: string;
  managerName: string | null;
  storeCount: number;
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
  trend: TrendPoint[];
};

type Report = {
  schemaVersion: number;
  campaign: string;
  generatedAt: string;
  timezone: string;
  freshness: { status: string; staleAfterMinutes: number; message: string | null };
  source: {
    reconciliation: {
      status: "matched" | "warning";
      cumulative: { official: number; storeSum: number; differenceRate: number };
      today: { official: number; storeSum: number; differenceRate: number };
    };
  };
  defaults: { scope: ScopeType; mode: Mode; featuredStoreId: string | null };
  hq: {
    storeCount: number;
    activeStoreCount: number;
    bonus: number;
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

export default function Prototype() {
  const [report, setReport] = useState<Report | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("today");
  const [scopeType, setScopeType] = useState<ScopeType>("hq");
  const [scopeId, setScopeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/report.json?ts=${Date.now()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`数据读取失败（${response.status}）`);
        return response.json() as Promise<Report>;
      })
      .then((payload) => {
        if (cancelled) return;
        setReport(payload);
        setMode(payload.defaults.mode);
        setScopeType(payload.defaults.scope);
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
                <ExclamationTriangleIcon /> BI汇总与门店合计存在差异，当前保留BI官方汇总值。
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
              <span>数据每30分钟同步 · 正式数据以BI快照为准</span>
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
            {stale ? "数据已延迟" : `下次${nextHalfHour(report.generatedAt)}`}
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
  const scopeValue = scopeType === "hq" ? "hq" : `${scopeType}:${scopeId ?? ""}`;
  return (
    <section className="scope-panel" aria-label="战报筛选">
      <div className="scope-row">
        <label htmlFor="scope-select">查看范围</label>
        <div className="select-shell">
          <select
            id="scope-select"
            value={scopeValue}
            onChange={(event) => {
              if (event.target.value === "hq") onNavigate("hq", null);
              else {
                const [type, id] = event.target.value.split(":") as [ScopeType, string];
                onNavigate(type, id);
              }
            }}
          >
            <option value="hq">总部总览</option>
            <optgroup label="按区域查看">
              {report.regions.map((region) => (
                <option key={region.id} value={`region:${region.id}`}>{region.name}</option>
              ))}
            </optgroup>
            <optgroup label="按门店查看">
              {report.stores.map((store) => (
                <option key={store.id} value={`store:${store.id}`}>{store.name}</option>
              ))}
            </optgroup>
          </select>
          <ChevronDownIcon aria-hidden="true" />
        </div>
      </div>
      <p className="scope-help">可切换总部总览、区域或门店</p>
      <div className="mode-switch" role="tablist" aria-label="数据口径">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "cumulative"}
          className={mode === "cumulative" ? "active" : ""}
          onClick={() => onModeChange("cumulative")}
        >累计</button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "today"}
          className={mode === "today" ? "active" : ""}
          onClick={() => onModeChange("today")}
        >今日</button>
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
          <Kpi label="近30分钟" value={signedMoney(delta)} tone={delta == null || delta >= 0 ? "green" : "red"} />
          <Kpi label="参与门店" value={`${report.hq.activeStoreCount}/${report.hq.storeCount}家`} />
          <Kpi label="距离目标" value={`¥${money(Math.max(target - amount, 0))}`} />
        </div>
      </section>

      <RegionAchievement report={report} onNavigate={onNavigate} />
      <BattleBoards report={report} scopeStores={report.stores} onNavigate={onNavigate} />
      <TrendSection title="全品牌储值趋势" points={report.hq.trend} />
      <StoreDirectory report={report} stores={report.stores} mode={mode} onNavigate={onNavigate} />
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
          近30分钟无增长 <strong>{noGrowth == null ? "待下次快照" : `${noGrowth}个区域`}</strong>。
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

  return (
    <>
      <section className="hero-card">
        <p className="eyebrow">区域视角 · {mode === "today" ? "今日" : "累计"}</p>
        <div className="entity-heading">
          <div><h2>{region.name}</h2><span className="region-tag">{region.storeCount}家门店</span></div>
          <div className="rank-display">第<strong>{rank ?? "—"}</strong>名<small>/{report.regions.length}区</small></div>
        </div>
        <div className="hero-heading compact">
          <div><strong className="hero-amount">¥ {money(amount)}</strong><span className="hero-caption">储值金额</span></div>
          <div className="hero-rate"><strong>{percent(completion)}</strong><span>挑战目标达成率</span></div>
        </div>
        <div className="hq-kpis">
          <Kpi label="近30分钟" value={signedMoney(delta)} tone={delta == null || delta >= 0 ? "green" : "red"} />
          <Kpi label="目标" value={`¥${money(target)}`} />
          <Kpi label="目标差额" value={`¥${money(Math.max(target - amount, 0))}`} />
        </div>
      </section>
      {mode === "cumulative" ? (
        <TargetProgressGrid amount={region.cumulative.amount} targets={region.cumulative.targets} rates={region.cumulative.rates} bonus={region.cumulative.bonus} />
      ) : null}
      <TrendSection title={`${region.name}储值趋势`} points={region.trend} />
      <BattleBoards report={report} scopeStores={stores} onNavigate={onNavigate} />
      <StoreDirectory report={report} stores={stores} mode={mode} onNavigate={onNavigate} title={`${region.name}门店`} />
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

  return (
    <>
      <section className="store-hero">
        <div className="entity-heading">
          <div><h2>{store.name}</h2><button type="button" className="region-tag" onClick={() => onNavigate("region", store.regionId)}>{store.regionName}</button></div>
        </div>
        <div className="store-score">
          <div>
            <strong className="hero-amount">¥ {money(amount)}</strong>
            <span className="hero-caption">{mode === "today" ? "今日" : "累计"}储值金额</span>
          </div>
          <div className="rank-display large">第<strong>{rank ?? "—"}</strong>名<small>/{report.hq.storeCount}家</small>
            <p>近30分钟 <span>{signedMoney(delta)}</span>{store.rankChange30 ? ` · 排名上升${store.rankChange30}位` : ""}</p>
          </div>
        </div>
      </section>

      <TargetProgressGrid amount={store.cumulative.amount} targets={store.cumulative.targets} rates={store.cumulative.rates} bonus={store.bonus} />

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
      <StoreDirectory report={report} stores={report.stores} mode={mode} onNavigate={onNavigate} selectedStoreId={store.id} />
    </>
  );
}

function TargetProgressGrid({ amount, targets, rates, bonus }: {
  amount: number;
  targets: TargetSet;
  rates: RateSet;
  bonus: number;
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
      <p className="bonus-line">当前奖金 <strong>¥{money(bonus)}</strong><span> · 累计储值 ¥{money(amount)}</span></p>
    </section>
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
        <h2>总部战况 <span>· 近30分钟</span></h2>
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
            <div className="waiting-delta"><ClockIcon /><span>等待下一次30分钟快照</span></div>
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

function StoreDirectory({ report, stores, mode, onNavigate, title = "全部门店", selectedStoreId }: {
  report: Report;
  stores: Store[];
  mode: Mode;
  onNavigate: (type: ScopeType, id: string | null) => void;
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
            <option value="delta">按近30分钟增量</option>
          </select>
          <ChevronDownIcon />
        </div>
      </div>
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
            <button
              key={store.id}
              type="button"
              className={store.id === selectedStoreId ? "store-row selected" : "store-row"}
              onClick={() => onNavigate("store", store.id)}
            >
              <span className={rank && rank <= 3 ? `rank-badge top-${rank}` : "rank-badge"}>{rank ?? "—"}</span>
              <span className="row-main"><strong>{store.name}</strong><small>{signedMoney(metricDelta(store, mode))}</small></span>
              <span className="region-cell">{store.regionName}</span>
              <span className="money-cell">¥{money(metricAmount(store, mode))}</span>
              <span className="rate-cell">{percent(metricCompletion(store, mode))}</span>
            </button>
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

function nextHalfHour(value: string) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0);
  return formatTime(date.toISOString());
}
