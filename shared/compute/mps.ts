/**
 * M8 宏观三因子压力分。PRD-001 §3.6。
 *
 *   raw_i = clamp(50 + 25·z_i, 0, 100)      z_i = (x_i − μ60) / σ60
 *   MPS   = 0.30·oil + 0.20·gold + 0.50·dxy
 *   H_宏  = 100 − MPS
 *
 * 方向：三因子上行对股市均为压力，故 z 取正号，raw 越高压力越大。
 * 缺数：按剩余因子权重重分配，绝不以 0 或 50 顶替。
 */

import type { MacroPattern, MacroState } from '../types'

export const MPS_WEIGHTS = { oil: 0.3, gold: 0.2, dxy: 0.5 } as const
export type MacroKey = keyof typeof MPS_WEIGHTS

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/** 单因子标准化。z 为 null（样本不足 / σ=0）时返回 null。 */
export function macroRaw(z: number | null): number | null {
  if (z === null || !Number.isFinite(z)) return null
  return clamp(50 + 25 * z, 0, 100)
}

/** 单因子方向。raw > 50 为压力，< 50 为缓解，恰好 50 视为中性。 */
export function macroState(raw: number | null): MacroState {
  if (raw === null) return 'neutral'
  if (raw > 50) return 'headwind'
  if (raw < 50) return 'tailwind'
  return 'neutral'
}

/**
 * MPS：加权压力分，缺数时按已用权重归一化。
 * 全部缺失返回 null，调用方据此把宏观维度排除出综合评分。
 */
export function mps(parts: {
  oil: number | null
  gold: number | null
  dxy: number | null
}): number | null {
  let sum = 0
  let wSum = 0
  for (const k of Object.keys(MPS_WEIGHTS) as MacroKey[]) {
    const raw = parts[k]
    if (raw === null || !Number.isFinite(raw)) continue
    sum += raw * MPS_WEIGHTS[k]
    wSum += MPS_WEIGHTS[k]
  }
  if (wSum === 0) return null
  return sum / wSum
}

/** H_宏观 = 100 − MPS */
export function macroHealth(mpsValue: number | null): number | null {
  return mpsValue === null ? null : 100 - mpsValue
}

/**
 * 八情景归并。PRD-001 §3.6：
 *   三因子同向压力 → 上调一级（riskBump = +1，风险更高）
 *   三因子同向缓解 → 下调一级（riskBump = −1）
 *   其余组合       → 维持（0）
 *
 * 档位调整在加权之后施加，不可被加权平均平滑 —— 因此这里只输出 bump，
 * 由 score 层移动到风险等级索引上，不参与 H 的计算。
 */
export function macroPattern(parts: {
  oil: number | null
  gold: number | null
  dxy: number | null
}): { pattern: MacroPattern; riskBump: number; pressures: number; reliefs: number } {
  let pressures = 0
  let reliefs = 0
  let valid = 0
  for (const k of Object.keys(MPS_WEIGHTS) as MacroKey[]) {
    const raw = parts[k]
    if (raw === null || !Number.isFinite(raw)) continue
    valid += 1
    if (raw > 50) pressures += 1
    else if (raw < 50) reliefs += 1
  }

  // 有效因子不足 3 个时不做档位调整：缺数必须表现为「不调整」，不能表现为「维持中性」
  if (valid < 3) return { pattern: 'neutral', riskBump: 0, pressures, reliefs }

  if (pressures === 3) return { pattern: 'triple_pressure', riskBump: 1, pressures, reliefs }
  if (reliefs === 3) return { pattern: 'triple_relief', riskBump: -1, pressures, reliefs }
  if (pressures === 2) return { pattern: 'two_pressure', riskBump: 0, pressures, reliefs }
  if (reliefs === 2) return { pattern: 'two_relief', riskBump: 0, pressures, reliefs }
  return { pattern: 'neutral', riskBump: 0, pressures, reliefs }
}

export const PATTERN_TEXT: Record<MacroPattern, string> = {
  triple_pressure: '三重压力：油、金、美元同步施压',
  two_pressure: '双向对冲，情绪中性',
  two_relief: '压力可控，趋势延续',
  triple_relief: '三重缓解：宏观环境转向宽松',
  neutral: '方向未明，不做档位调整',
}
