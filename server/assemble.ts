/**
 * 合并 latest.json + metrics.json → DashboardResponse。
 *
 * 分工原则：日更算序列，盘中算截面。本文件是两条流的汇合点，
 * 也是唯一允许「同时看到两边字段」的地方，因此所有跨流计算（z-score 用最新价、corr60）都放这里。
 */

import type {
  DashboardResponse,
  DailyMetrics,
  LatestSnapshot,
  MacroBlock,
  MacroFactor,
  Meta,
  Point,
  SourceTag,
} from '../shared/types'
import {
  buildAdvice,
  buildFearGreed,
  buildQuote,
  buildRsi,
  buildValuation,
  buildVxn,
  computeScore,
  hv,
  macroHealth,
  macroPattern,
  macroRaw,
  macroState,
  mps,
  rollingCorr,
  round,
  stdev,
  mean as avg,
} from '../shared/compute'
import { closeMomentUtc, etParts, etTradeDate, tradingPhase } from './calendar'

/**
 * 评分模型版本。Q8（宏观是否进入综合评分）未定，故默认 v1.0 四维等权，
 * 与 API 契约 §6 的示例一致。确认后改此常量即可切到 v1.1 五维。
 */
export const SCORE_MODEL: 'v1.0' | 'v1.1' = 'v1.0'

const DXY_WARNING = '恐贪底层标的为 S&P 500（CNN 口径），非 NDX'

/**
 * 盘中 z-score：窗口取「历史尾部 window−1 个点 + 当前价」。
 * 直接把最新价当第 window 个点，使压力分随盘中价格变动，而不是等到次日日更才更新。
 */
function zWithLatest(series: readonly Point[], latest: number | null, window = 60): number | null {
  if (latest === null || !Number.isFinite(latest)) return null
  if (series.length < window - 1) return null
  const tail = series.slice(-(window - 1)).map((p) => p.close)
  const win = [...tail, latest]
  const m = avg(win)
  const sd = stdev(win)
  if (m === null || sd === null || sd === 0) return null
  return (latest - m) / sd
}

/** HV20：用「历史尾部 + 当前价」，让盘中波动率也反映当日变动 */
function hvWithLatest(series: readonly Point[], latest: number | null, n = 20): number | null {
  if (latest === null || !Number.isFinite(latest)) return null
  if (series.length < n) return null
  const closes = [...series.slice(-n).map((p) => p.close), latest]
  return hv(closes, n)
}

function buildFactor(
  label: string,
  now: { value: number; chg1d: number | null; chg5d: number | null } | null,
  series: readonly Point[],
  ndxSeries: readonly Point[],
): MacroFactor | null {
  if (now === null) return null
  const z = zWithLatest(series, now.value)
  const raw = macroRaw(z)
  return {
    label,
    value: round(now.value, 4),
    chg1d: now.chg1d ?? 0,
    chg5d: now.chg5d ?? 0,
    hv20: round(hvWithLatest(series, now.value) ?? 0, 2),
    corr60: round(rollingCorr(ndxSeries, series, 60) ?? 0, 3),
    raw: raw === null ? 50 : round(raw, 2),
    state: macroState(raw),
  }
}

function buildMacro(latest: LatestSnapshot, metrics: DailyMetrics | null): MacroBlock | null {
  if (!latest.macroNow || !metrics) return null
  const s = metrics.macroSeries

  const oil = buildFactor('WTI 原油', latest.macroNow.oil, s.oil, s.ndx)
  const gold = buildFactor('COMEX 黄金', latest.macroNow.gold, s.gold, s.ndx)
  const dxy = buildFactor('ICE 美元指数', latest.macroNow.dxy, s.dxy, s.ndx)
  if (!oil || !gold || !dxy) return null

  const mpsValue = mps({ oil: oil.raw, gold: gold.raw, dxy: dxy.raw })
  const { pattern, riskBump } = macroPattern({ oil: oil.raw, gold: gold.raw, dxy: dxy.raw })

  return {
    oil,
    gold,
    dxy,
    composite: {
      mps: mpsValue === null ? 50 : round(mpsValue, 2),
      health: macroHealth(mpsValue) === null ? 50 : round(100 - (mpsValue as number), 2),
      pattern,
      riskBump,
    },
  }
}

export interface AssembleOptions {
  now?: Date
  /** 上一版 latest，用于抓取失败时兜底 */
  prev?: LatestSnapshot | null
}

export function assembleDashboard(
  latest: LatestSnapshot,
  metrics: DailyMetrics | null,
  options: AssembleOptions = {},
): DashboardResponse {
  const now = options.now ?? new Date()
  const warnings = [...latest.meta.warnings]
  const sources: Record<string, SourceTag> = { ...latest.meta.sources }

  if (!warnings.some((w) => w.includes('S&P 500'))) warnings.push(DXY_WARNING)

  // ---- M1 今日概览 ----
  // quantize 在装配层做，采集层只存原始价量
  const quote = latest.quote
    ? buildQuote({
        close: latest.quote.close,
        prevClose: latest.quote.prevClose,
        open: latest.quote.open,
        high: latest.quote.high,
        low: latest.quote.low,
        volume: latest.quote.volume,
      })
    : null

  // ---- M2 恐贪 ----
  const fearGreed = latest.fearGreed
    ? buildFearGreed({
        score: latest.fearGreed.score,
        prevClose: latest.fearGreed.prevClose,
        oneWeek: latest.fearGreed.oneWeek,
        oneMonth: latest.fearGreed.oneMonth,
        oneYear: latest.fearGreed.oneYear,
        components: latest.fearGreed.components,
      })
    : null

  // ---- M3 VXN / M4 估值 / M5 RSI：全部来自日更 ----
  const vxn =
    metrics && metrics.vxn.close > 0
      ? buildVxn({
          value: metrics.vxn.close,
          prevClose: metrics.vxn.prevClose,
          ma20: metrics.vxn.ma20 || null,
        })
      : null
  if (!vxn) {
    sources.vxn = 'missing'
    warnings.push('VXN 不可用（CBOE 源失败），波动维度不参与评分')
  }

  const valuation =
    metrics && metrics.pe.peTTM > 0
      ? buildValuation({ peTTM: metrics.pe.peTTM, percentile: metrics.pe.percentile })
      : null
  if (!valuation) {
    sources.pe = 'missing'
    warnings.push('估值不可用（蛋卷源失败），估值维度不参与评分')
  }

  const rsi =
    metrics && metrics.rsi.rsi6 > 0
      ? buildRsi({
          rsi6: metrics.rsi.rsi6,
          rsi12: metrics.rsi.rsi12,
          rsi24: metrics.rsi.rsi24,
        })
      : null
  if (!rsi) {
    sources.rsi = 'missing'
    warnings.push('RSI 不可用（NDX 日K 失败），动量维度不参与评分')
  }

  // ---- M8 宏观 ----
  const macro = buildMacro(latest, metrics)

  // ---- M6 综合评分 ----
  const score = computeScore(
    {
      fgi: fearGreed?.score ?? null,
      vxn: vxn?.value ?? null,
      pePercentile: valuation?.percentile ?? null,
      rsiMean: rsi?.mean ?? null,
      macroHealth: macro?.composite.health ?? null,
    },
    {
      model: SCORE_MODEL,
      riskBump: SCORE_MODEL === 'v1.1' ? (macro?.composite.riskBump ?? 0) : 0,
    },
  )

  // ---- M7 操作建议 ----
  const advice = score ? buildAdvice(score.riskLevel, rsi?.slope ?? null) : null

  const tradeDate = metrics?.tradeDate ?? etTradeDate(now)
  const phase = tradingPhase(now)

  /**
   * 数据新鲜度必须分两种情形算，否则会把周末的收盘价标成「延迟 15 分钟」：
   * - 盘中且在当天：上游快照固定约 15 分钟延迟；
   * - 其余时段（盘前/盘后/周末/假日）：从该交易日收盘算起，如实给出分钟数。
   */
  const isLiveBar = phase === 'open' && tradeDate === etParts(now).iso
  const quoteMoment = isLiveBar ? new Date(now) : closeMomentUtc(tradeDate, now)
  const delayMinutes = isLiveBar
    ? 15
    : Math.max(0, Math.round((now.getTime() - quoteMoment.getTime()) / 60_000))

  const meta: Meta = {
    symbol: 'NDX',
    tradeDate,
    generatedAt: latest.meta.generatedAt,
    delayMinutes,
    quoteAt: quoteMoment.toISOString(),
    stale: latest.meta.stale || quote === null,
    phase,
    sources,
    warnings: dedupe(warnings),
  }

  return { meta, quote, fearGreed, vxn, valuation, rsi, macro, score, advice }
}

function dedupe(xs: readonly string[]): string[] {
  return [...new Set(xs)]
}

export type { LatestSnapshot, DailyMetrics }
