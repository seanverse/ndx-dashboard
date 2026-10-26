/**
 * DXY 自算与校验。TECH-001 §1.3 / §1.4。
 *
 *   DXY = 50.14348112 × EURUSD^−0.576 × USDJPY^0.136 × GBPUSD^−0.119
 *                     × USDCAD^0.091  × USDSEK^0.042  × USDCHF^0.036
 *
 * 分工：
 *   L1 实时显示 → 新浪 DINIW 快照（95 ms）
 *   L2 历史序列 → 本文件自算（3113 天，2014-11-07 起，受 USDSEK 起点限制）
 *   L3 交叉校验 → CNBC .DXY，每日 1 次，阈值 0.05%
 *
 * 为什么必须自算：DINIW 只有快照，历史日 K 在 ForexService / GlobalFuturesService /
 * hf_DX / hf_UDI / fx_sdxy 全部取不到，而 MPS 的 60 日 z-score 需要历史序列。
 */

import type { FxBar, FxKey } from './adapters/forex'

const CONST = 50.14348112
const EXPONENTS: Record<FxKey, number> = {
  EURUSD: -0.576,
  USDJPY: 0.136,
  GBPUSD: -0.119,
  USDCAD: 0.091,
  USDSEK: 0.042,
  USDCHF: 0.036,
}

export interface DxyPoint {
  date: string
  close: number
}

export interface DxyResult {
  series: DxyPoint[]
  /** 参与合成的货币对数量，< 6 时序列可信度下降 */
  pairCount: number
  missingPairs: FxKey[]
}

/**
 * 按日期取交集合成。任一货币对缺失即无法计算该日 —— 不做插值，
 * 因为插值会让 z-score 的 σ 被人为压小，使压力分虚高。
 */
export function computeDxy(fx: Partial<Record<FxKey, FxBar[]>>): DxyResult {
  const keys = Object.keys(EXPONENTS) as FxKey[]
  const present = keys.filter((k) => (fx[k]?.length ?? 0) > 0)
  const missingPairs = keys.filter((k) => !present.includes(k))

  if (present.length < 6) {
    return { series: [], pairCount: present.length, missingPairs }
  }

  // 以最短序列为基准建日期索引，再逐日取其余五对
  const maps = new Map<FxKey, Map<string, number>>()
  for (const k of keys) {
    const m = new Map<string, number>()
    for (const bar of fx[k] as FxBar[]) m.set(bar.date, bar.close)
    maps.set(k, m)
  }

  const base = maps.get('EURUSD') as Map<string, number>
  const series: DxyPoint[] = []

  for (const [date, eurusd] of base) {
    let value = CONST * eurusd ** EXPONENTS.EURUSD
    let ok = true
    for (const k of keys) {
      if (k === 'EURUSD') continue
      const v = maps.get(k)?.get(date)
      if (v === undefined) {
        ok = false
        break
      }
      value *= v ** EXPONENTS[k]
    }
    if (ok && Number.isFinite(value) && value > 0) series.push({ date, close: value })
  }

  series.sort((a, b) => a.date.localeCompare(b.date))
  return { series, pairCount: present.length, missingPairs }
}

/**
 * L3 校验：自算值与官方快照的偏差。
 * 阈值 0.05% 是实测偏差（0.0028%）的约 25 倍余量 —— 只拦明显的静默错误
 * （某个货币对串标的、错位一天），不拦正常的分发延迟。
 */
export const DXY_TOLERANCE_PCT = 0.05

/**
 * 时点不同时的宽容差。
 * DINIW 是实时报价，而自算值是六货币对日 K 的收盘合成 —— 若在亚洲时段跑
 * （离美股收盘已十几小时），美元指数早已走动，0.05% 会误报。
 * 这种情形只做量级校验，拦串标的/错位一天这类硬错误。
 */
export const DXY_LOOSE_TOLERANCE_PCT = 0.5

export function checkDxyDeviation(
  calculated: number,
  official: number,
  sameSession = true,
): {
  deviationPct: number
  tolerancePct: number
  ok: boolean
} {
  const tolerancePct = sameSession ? DXY_TOLERANCE_PCT : DXY_LOOSE_TOLERANCE_PCT
  if (!Number.isFinite(calculated) || !Number.isFinite(official) || official === 0) {
    return { deviationPct: Number.POSITIVE_INFINITY, tolerancePct, ok: false }
  }
  const deviationPct = Math.abs((calculated - official) / official) * 100
  return { deviationPct, tolerancePct, ok: deviationPct <= tolerancePct }
}
