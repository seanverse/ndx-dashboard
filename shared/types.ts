/**
 * API 契约：前后端共用。字段定义以 docs/TECH-001 §6 为准。
 * 唯一改动纪律：任何字段增删都要同步 TECH-001 §6 与 PRD-001 对应指标章节。
 */

// ---------- 枚举 ----------

/** 单字段来源标记。stale = 本次抓取失败、沿用上版；missing = 从未取到。 */
export type SourceTag =
  | 'sina'
  | 'tencent'
  | 'cboe'
  | 'cnn'
  | 'danjuan'
  | 'calc'
  | 'stale'
  | 'missing'

/** pre 盘前 / open 盘中 / post 收盘后定稿 / closed 休市 */
export type TradingPhase = 'pre' | 'open' | 'post' | 'closed'

/** 风险等级，与 PRD-001 §3.7 分档表一一对应 */
export type RiskLevel = '低' | '偏低' | '中性' | '偏高' | '高' | '极高'

/** CNN 恐贪五档 */
export type FgiRating =
  | 'extreme_fear'
  | 'fear'
  | 'neutral'
  | 'greed'
  | 'extreme_greed'

/** RSI 五档，PRD-001 §3.5 */
export type RsiRating =
  | 'oversold'
  | 'weak'
  | 'neutral'
  | 'strong'
  | 'overbought'

/** VXN 六档，PRD-001 §3.3 */
export type VxnState =
  | 'very_low'
  | 'low'
  | 'normal'
  | 'elevated'
  | 'high'
  | 'extreme'

/** 估值四档，PRD-001 §3.4 */
export type ValuationState = 'cheap' | 'fair' | 'expensive' | 'very_expensive'

/**
 * 宏观八情景归并为四类，PRD-001 §3.6。
 * neutral = 三因子方向不一致且无净方向，或有效因子不足 3 个（缺数时不做档位调整）。
 */
export type MacroPattern =
  | 'triple_pressure'
  | 'two_pressure'
  | 'two_relief'
  | 'triple_relief'
  | 'neutral'

/** 单因子对股市的作用方向 */
export type MacroState = 'headwind' | 'neutral' | 'tailwind'

/** 动量方向，PRD-001 §3.5：D = RSI6 − RSI24 */
export type MomentumSlope = 'down' | 'up' | 'flat'

// ---------- 子结构 ----------

export interface Meta {
  symbol: string
  /** 数据所属交易日，美东口径 YYYY-MM-DD */
  tradeDate: string
  /** 本 payload 生成时刻，ISO 8601 UTC */
  generatedAt: string
  /**
   * 距数据实际时刻的分钟数。
   * 盘中（phase=open 且 tradeDate 为当天）取上游快照延迟 15；
   * 其余时段取「现在 − tradeDate 收盘时刻」，因此周末/盘前会显示上千分钟，这是事实而非故障。
   */
  delayMinutes: number
  /** 数据实际对应的时刻（tradeDate 收盘，或盘中为快照时刻），ISO 8601 UTC */
  quoteAt: string
  /** 真 = 本次未取到新数据，内容为上版 */
  stale: boolean
  phase: TradingPhase
  sources: Record<string, SourceTag>
  warnings: string[]
}

/**
 * 原始行情，不含任何派生值。
 * 涨跌额 / 涨跌幅 / 振幅只在 assemble 阶段由 buildQuote 算一次 —— 避免采集层与装配层各算一遍导致不一致。
 */
export interface RawQuote {
  close: number
  prevClose: number
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
}

export interface Quote {
  close: number
  prevClose: number
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  /** close − prevClose */
  change: number
  /** 百分比数值，1.171 表示 1.171% */
  changePct: number
  /** (high − low) / prevClose × 100 */
  amplitude: number | null
}

export interface FgiComponent {
  key: string
  label: string
  score: number
  rating: string
}

export interface FearGreed {
  score: number
  rating: FgiRating
  prevClose: number | null
  oneWeek: number | null
  oneMonth: number | null
  oneYear: number | null
  components: FgiComponent[]
}

export interface VxnBlock {
  value: number
  change: number
  changePct: number
  state: VxnState
  /** 20 日均值，可空 */
  ma20: number | null
}

export interface ValuationBlock {
  peTTM: number
  /** 0–100，蛋卷原始值是 0–1 小数，适配层已 ×100 */
  percentile: number
  window: string
  state: ValuationState
}

export interface RsiBlock {
  rsi6: number
  rsi12: number
  rsi24: number
  /** (rsi6 + rsi12 + rsi24) / 3 */
  mean: number
  /** 三周期一致时取该档，分歧时取 mean 的档并置 consistency=false */
  combined: RsiRating
  consistency: boolean
  /** D = rsi6 − rsi24 */
  slope: MomentumSlope
}

export interface MacroFactor {
  label: string
  value: number
  /** 日环比 %。日 K 末根是当日滚动值时，以倒数第二根为基准 */
  chg1d: number
  /** 5 日环比 % */
  chg5d: number
  /** 20 日年化历史波动率 % */
  hv20: number
  /** 与 NDX 日收益的 60 日相关系数 */
  corr60: number
  /** clamp(50 + 25·z, 0, 100)，越高越构成压力 */
  raw: number
  state: MacroState
}

export interface MacroComposite {
  /** MPS = 0.30·oil + 0.20·gold + 0.50·dxy */
  mps: number
  /** 100 − MPS */
  health: number
  pattern: MacroPattern
  /** 三同向压力 +1，三同向缓解 −1，其余 0 */
  riskBump: number
}

export interface MacroBlock {
  oil: MacroFactor
  gold: MacroFactor
  dxy: MacroFactor
  composite: MacroComposite
}

export interface ScoreDims {
  sentiment: number | null
  volatility: number | null
  valuation: number | null
  momentum: number | null
  /** 仅五维模式存在 */
  macro?: number | null
}

export interface ScoreBlock {
  model: 'v1.0' | 'v1.1'
  health: number
  stars: number
  riskLevel: RiskLevel
  dims: ScoreDims
  weights: Record<string, number>
  /** 已施加在风险档位上的宏观调整；0 表示未调整 */
  riskBump: number
  /** 未加宏观调整的基准结果，供 UI 说明「为什么星级被降了一档」 */
  baseline?: {
    health: number
    stars: number
    riskLevel: RiskLevel
  }
}

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5'

export interface AdviceBlock {
  ruleId: RuleId
  position: [number, number]
  /** 长期定投：已持仓、按周期投入者 */
  longTerm: string[]
  /** 新资金建仓：尚未建仓、准备入场者 */
  newMoney: string[]
  momentumHint: string
}

export interface DashboardResponse {
  meta: Meta
  quote: Quote | null
  fearGreed: FearGreed | null
  vxn: VxnBlock | null
  valuation: ValuationBlock | null
  rsi: RsiBlock | null
  macro: MacroBlock | null
  score: ScoreBlock | null
  advice: AdviceBlock | null
}

/** 日线点，按日期升序 */
export interface Point {
  date: string
  close: number
}

/** daily.json 落盘结构，只含日更产物 */
export interface DailyMetrics {
  tradeDate: string
  generatedAt: string
  rsi: { rsi6: number; rsi12: number; rsi24: number; mean: number }
  hv20: number
  /**
   * 宏观与指数的近期日线。collect 用它在只有快照的情况下算 chg5d 与 corr60，
   * 只保留尾部窗口（默认 120 天）以控制 payload 体积。
   */
  macroSeries: {
    oil: Point[]
    gold: Point[]
    dxy: Point[]
    ndx: Point[]
  }
  /** 三因子 60 日 z-score 的输入参数，落盘供复核 */
  macroStats: {
    window: number
    oil: { mean: number; sd: number } | null
    gold: { mean: number; sd: number } | null
    dxy: { mean: number; sd: number } | null
  }
  vxn: {
    close: number
    prevClose: number
    change: number
    changePct: number
    ma20: number
    series: Point[]
  }
  pe: { peTTM: number; percentile: number }
  /** DXY 自算值与官方快照的比对结果（L3 校验器） */
  dxyCheck: {
    calculated: number
    official: number | null
    deviationPct: number | null
    /** 本次校验采用的容差（%）：同时点 0.05，跨时点 0.5 */
    tolerancePct: number
    /** 官方值为同时点收盘快照时为真；false 表示只是量级校验 */
    sameSession: boolean
    ok: boolean
  } | null
  /** 本次日更抓取失败的源，前端可据此提示降级 */
  failedSources: string[]
}

/**
 * 按日追加的快照（`data/daily/YYYY-MM-DD.json`）。
 *
 * 与 DailyMetrics 的唯一区别：剥离 macroSeries 与 vxn.series 这类上游长序列。
 * 那些序列每天重复同一段历史，按日全量存等于一年 8 MB 里九成是副本；
 * 只留「当天算出来的值」与「不可重算的事实」，一天约 0.6 KB，十年不到 4 MB。
 *
 * 日期分片的写一次就不再改，因此可以长缓存；它也是唯一的跨日历史来源。
 */
export interface DailySnapshot {
  tradeDate: string
  generatedAt: string
  rsi: DailyMetrics['rsi']
  hv20: number
  vxn: Omit<DailyMetrics['vxn'], 'series'>
  pe: DailyMetrics['pe']
  macroStats: DailyMetrics['macroStats']
  dxyCheck: DailyMetrics['dxyCheck']
  failedSources: string[]
  /** 当日收盘结论；无法确认与 tradeDate 同日时为 null */
  verdict: DailyVerdict | null
}

/** 系统在当日给出的判断，日后复盘「当时说了什么」的唯一凭据 */
export interface DailyVerdict {
  model: 'v1.0' | 'v1.1'
  health: number
  stars: number
  riskLevel: RiskLevel
  ruleId: RuleId
  position: [number, number]
}

/** 单个宏观因子的盘中截面值。chg5d 依赖日更序列，序列缺失时为 null */
export interface MacroNowValue {
  value: number
  chg1d: number | null
  chg5d: number | null
}

/** collect 端点写入的 latest.json，只含盘中截面原料 */
export interface LatestSnapshot {
  meta: Meta
  quote: RawQuote | null
  fearGreed: FearGreed | null
  /** 三因子的现值与环比。hv20 / corr60 / raw 由 assemble 用 daily 序列现算；单因子缺失时为 null */
  macroNow: {
    oil: MacroNowValue | null
    gold: MacroNowValue | null
    dxy: MacroNowValue | null
  } | null
}
