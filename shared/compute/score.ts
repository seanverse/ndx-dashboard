/**
 * M6 综合评分。PRD-001 §3.7。
 *
 *   四维各输出 0–100 健康分（越高越安全），等权平均得 H，星级 = H ÷ 20。
 *   五维扩展（并入 M8 宏观）权重改为 {情绪 .22, 波动 .22, 估值 .18, 动量 .23, 宏观 .15}。
 *
 * 三条硬规则：
 *   1. 缺数不按 0 计，按剩余权重重分配（PRD A5）
 *   2. 宏感情景的档位调整施加在风险等级索引上，不进入 H，否则会被加权平均平滑掉
 *   3. 星级 0.5 粒度：round(H/20×2)/2
 */

import type { RiskLevel, ScoreBlock } from '../types.js'
import {
  POSITION_BY_RISK,
  RSI_BANDS,
  RISK_BANDS,
  RISK_LEVELS,
  clampRiskIndex,
  pickBand,
  riskIndex,
} from './bands.js'

export interface ScoreInput {
  /** CNN 恐贪 0–100 */
  fgi: number | null
  /** VXN 指数点位 */
  vxn: number | null
  /** 估值历史百分位 0–100 */
  pePercentile: number | null
  /** RSI6/12/24 均值 */
  rsiMean: number | null
  /** 100 − MPS，仅五维模式使用 */
  macroHealth: number | null
}

export type ScoreModel = 'v1.0' | 'v1.1'

export const WEIGHTS_V10 = {
  sentiment: 0.25,
  volatility: 0.25,
  valuation: 0.25,
  momentum: 0.25,
} as const

export const WEIGHTS_V11 = {
  sentiment: 0.22,
  volatility: 0.22,
  valuation: 0.18,
  momentum: 0.23,
  macro: 0.15,
} as const

/** VXN 分段线性锚点 [VXN, 健康分]，PRD-001 §3.7 表 */
const VXN_POINTS: readonly [number, number][] = [
  [15, 100],
  [20, 75],
  [25, 55],
  [30, 40],
  [35, 30],
  [50, 10],
  [60, 0],
]

/** VXN → 波动健康分。段外做常数延拓，结果再 clamp 到 0–100。 */
export function volatilityScore(vxn: number | null): number | null {
  if (vxn === null || !Number.isFinite(vxn)) return null
  const first = VXN_POINTS[0] as [number, number]
  const last = VXN_POINTS[VXN_POINTS.length - 1] as [number, number]
  if (vxn <= first[0]) return first[1]
  if (vxn >= last[0]) return last[1]
  for (let i = 1; i < VXN_POINTS.length; i++) {
    const [x1, y1] = VXN_POINTS[i] as [number, number]
    const [x0, y0] = VXN_POINTS[i - 1] as [number, number]
    if (vxn <= x1) return y0 + ((vxn - x0) / (x1 - x0)) * (y1 - y0)
  }
  return last[1]
}

/** RSI 均值的档位 → 动量健康分。与 RSI 五档一一对应，避免两处口径漂移。 */
const MOMENTUM_BY_RSI_BAND: Record<string, number> = {
  oversold: 25,
  weak: 40,
  neutral: 60,
  strong: 75,
  overbought: 30,
}

export function momentumScore(rsiMean: number | null): number | null {
  const band = pickBand(RSI_BANDS, rsiMean)
  return band === null ? null : (MOMENTUM_BY_RSI_BAND[band.key] ?? null)
}

/** 估值健康分 = 100 − 百分位 */
export function valuationScore(percentile: number | null): number | null {
  if (percentile === null || !Number.isFinite(percentile)) return null
  return 100 - percentile
}

/** 情绪健康分：FGI 已是 0–100 标准化分，不做二次变换 */
export function sentimentScore(fgi: number | null): number | null {
  if (fgi === null || !Number.isFinite(fgi)) return null
  return fgi
}

export function starsFromHealth(health: number): number {
  const h = Math.min(100, Math.max(0, health))
  return Math.round((h / 20) * 2) / 2
}

/** H → 风险等级 */
export function riskFromHealth(health: number): RiskLevel {
  const band = pickBand(RISK_BANDS, health)
  return band?.key ?? '极高'
}

export interface ScoreOptions {
  model?: ScoreModel
  /** 宏观情景的档位调整，+1 = 风险上调一级 */
  riskBump?: number
}

/**
 * 加权平均，缺数按剩余权重归一化。
 * 返回 health 与「实际参与计算的权重表」，后者可直接展示给用户解释权重分配。
 */
function weightedAverage(
  values: Record<string, number | null>,
  weights: Record<string, number>,
): { health: number | null; usedWeights: Record<string, number>; missing: string[] } {
  let sum = 0
  let wSum = 0
  const missing: string[] = []
  for (const [k, w] of Object.entries(weights)) {
    const v = values[k]
    if (v === null || v === undefined || !Number.isFinite(v)) {
      missing.push(k)
      continue
    }
    sum += v * w
    wSum += w
  }
  // 缺数维度的展示权重必须为 0，参与维度归一化后总和恰为 1。
  // 若把原始权重一并除以 wSum，缺失项会残留权重，总和变成 1/Σw_used。
  const usedWeights: Record<string, number> = {}
  for (const [k, w] of Object.entries(weights)) {
    const v = values[k]
    const isMissing = v === null || v === undefined || !Number.isFinite(v)
    usedWeights[k] = isMissing || wSum === 0 ? 0 : w / wSum
  }
  return { health: wSum === 0 ? null : sum / wSum, usedWeights, missing }
}

/**
 * 主入口。返回 ScoreBlock，含 riskBump 施加前后的对照，便于 UI 解释「为什么降了一档」。
 */
export function computeScore(input: ScoreInput, options: ScoreOptions = {}): ScoreBlock | null {
  const model: ScoreModel = options.model ?? 'v1.0'
  const riskBump = options.riskBump ?? 0

  const dimValues: Record<string, number | null> = {
    sentiment: sentimentScore(input.fgi),
    volatility: volatilityScore(input.vxn),
    valuation: valuationScore(input.pePercentile),
    momentum: momentumScore(input.rsiMean),
  }

  const weights: Record<string, number> =
    model === 'v1.1'
      ? { ...WEIGHTS_V11, macro: WEIGHTS_V11.macro }
      : { ...WEIGHTS_V10 }

  if (model === 'v1.1') dimValues.macro = input.macroHealth

  const { health, usedWeights } = weightedAverage(dimValues, weights)
  if (health === null) return null

  const baseRisk = riskFromHealth(health)
  const finalIndex = clampRiskIndex(riskIndex(baseRisk) - riskBump)
  const riskLevel = RISK_LEVELS[finalIndex] ?? baseRisk

  const stars = starsFromHealth(health)

  return {
    model,
    health: Math.round(health * 100) / 100,
    stars,
    riskLevel,
    dims: {
      sentiment: dimValues.sentiment ?? null,
      volatility: dimValues.volatility ?? null,
      valuation: dimValues.valuation ?? null,
      momentum: dimValues.momentum ?? null,
      ...(model === 'v1.1' ? { macro: dimValues.macro ?? null } : {}),
    },
    weights: usedWeights,
    riskBump,
    baseline: { health: Math.round(health * 100) / 100, stars, riskLevel: baseRisk },
  }
}

/** 由评分结果推导建议仓位 */
export function positionFor(riskLevel: RiskLevel): [number, number] {
  return POSITION_BY_RISK[riskLevel]
}
