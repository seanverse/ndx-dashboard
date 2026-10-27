/**
 * 把原始抓取值组装为契约里的展示块，所有派生字段在此一次算清。
 * 前端不重复计算 —— 除下钻时用同一份纯函数复算。
 */

import type {
  FearGreed,
  FgiComponent,
  FgiRating,
  MomentumSlope,
  Quote,
  RsiBlock,
  RsiRating,
  ValuationBlock,
  VxnBlock,
} from '../types.js'
import { FGI_BANDS, PE_BANDS, RSI_BANDS, VXN_BANDS, pickBand } from './bands.js'

/** M1：涨跌额 / 涨跌幅 / 振幅，分母一律昨收（PRD-001 §3.1 与 §4.3 反推结论） */
export function buildQuote(input: {
  close: number
  prevClose: number
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
}): Quote {
  const change = input.close - input.prevClose
  const changePct = input.prevClose === 0 ? 0 : (change / input.prevClose) * 100
  const amplitude =
    input.high !== null && input.low !== null && input.prevClose !== 0
      ? ((input.high - input.low) / input.prevClose) * 100
      : null
  return {
    close: input.close,
    prevClose: input.prevClose,
    open: input.open,
    high: input.high,
    low: input.low,
    volume: input.volume,
    change,
    changePct,
    amplitude,
  }
}

/** M2：恐贪分档。七子指标顺序固定，便于 UI 折叠面板稳定排列 */
export const FGI_COMPONENT_LABELS: Record<string, string> = {
  market_momentum_sp125: '股价动量',
  stock_price_strength: '股价强度',
  stock_price_breadth: '市场广度',
  put_call_options: '期权情绪',
  market_volatility_vix_50: '市场波动',
  safe_haven_demand: '避险需求',
  junk_bond_demand: '信用环境',
}

export function buildFearGreed(input: {
  score: number
  prevClose: number | null
  oneWeek: number | null
  oneMonth: number | null
  oneYear: number | null
  components: FgiComponent[]
}): FearGreed {
  const band = pickBand(FGI_BANDS, input.score)
  return {
    score: input.score,
    rating: (band?.key ?? 'neutral') as FgiRating,
    prevClose: input.prevClose,
    oneWeek: input.oneWeek,
    oneMonth: input.oneMonth,
    oneYear: input.oneYear,
    components: input.components,
  }
}

/** M3：VXN。change / changePct 的基准是前一日收盘，不是今日开盘 */
export function buildVxn(input: {
  value: number
  prevClose: number
  ma20: number | null
}): VxnBlock {
  const change = input.value - input.prevClose
  const changePct = input.prevClose === 0 ? 0 : (change / input.prevClose) * 100
  const band = pickBand(VXN_BANDS, input.value)
  return {
    value: input.value,
    change,
    changePct,
    state: band?.key ?? 'normal',
    ma20: input.ma20,
  }
}

/** M4：估值。percentile 入参已是 0–100 */
export function buildValuation(input: {
  peTTM: number
  percentile: number
  window?: string
}): ValuationBlock {
  const band = pickBand(PE_BANDS, input.percentile)
  return {
    peTTM: input.peTTM,
    percentile: input.percentile,
    window: input.window ?? '10y',
    state: band?.key ?? 'fair',
  }
}

/**
 * M5：RSI 综合信号。
 * 三期同区间 → 输出该区间信号；跨档 → 输出均值 M 的档并置 consistency = false。
 * 这条规则修的是原图 D2：RSI6 25.74 / RSI12 27.45 都已跌破 30，应判「超卖」而非「偏弱」。
 */
export function buildRsi(input: {
  rsi6: number | null
  rsi12: number | null
  rsi24: number | null
}): RsiBlock | null {
  const { rsi6, rsi12, rsi24 } = input
  if (rsi6 === null || rsi12 === null || rsi24 === null) return null

  const b6 = pickBand(RSI_BANDS, rsi6)
  const b12 = pickBand(RSI_BANDS, rsi12)
  const b24 = pickBand(RSI_BANDS, rsi24)
  const mean = (rsi6 + rsi12 + rsi24) / 3
  const meanBand = pickBand(RSI_BANDS, mean)

  const allSame = b6?.key === b12?.key && b12?.key === b24?.key
  const combined = (allSame ? b6?.key : meanBand?.key) ?? 'neutral'

  const d = rsi6 - rsi24
  const slope: MomentumSlope = d < -1e-9 ? 'down' : d > 1e-9 ? 'up' : 'flat'

  return {
    rsi6,
    rsi12,
    rsi24,
    mean,
    combined: combined as RsiRating,
    consistency: allSame,
    slope,
  }
}

/** 三周期分别的中文标签，供 M5 三卡直接显示 */
export function rsiLabels(r: RsiBlock): { rsi6: string; rsi12: string; rsi24: string } {
  return {
    rsi6: pickBand(RSI_BANDS, r.rsi6)?.label ?? '—',
    rsi12: pickBand(RSI_BANDS, r.rsi12)?.label ?? '—',
    rsi24: pickBand(RSI_BANDS, r.rsi24)?.label ?? '—',
  }
}
