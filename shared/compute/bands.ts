/**
 * 分档阈值：唯一定义处。PRD-001 §3.2 / §3.3 / §3.4 / §3.5 / §3.7。
 *
 * 统一语义：左闭右开 [prev, max)；最后一档右闭。
 * 实现方式是把每档写成「上界 max」，命中规则 x < max，故最后一档 max = Infinity。
 */

import type {
  FgiRating,
  RiskLevel,
  RsiRating,
  ValuationState,
  VxnState,
} from '../types'

export interface Band<T extends string> {
  /** 上界（不含）。第一档从 −∞ 起。 */
  max: number
  /** 档位枚举值 */
  key: T
  /** 中文标签，直接用于 UI */
  label: string
  /** 解读文案，UI 展示用 */
  text: string
}

/** 在升序 band 数组里定位。x 为 NaN / 非有限数时返回 null，由调用方按缺数处理。 */
export function pickBand<T extends string>(
  bands: readonly Band<T>[],
  x: number | null | undefined,
): Band<T> | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null
  for (const b of bands) if (x < b.max) return b
  return bands[bands.length - 1] ?? null
}

// ---------- M2 恐贪：CNN 官方五段阈值 24/44/55/75 ----------
// PRD 表写「0–24 / 25–44 / 45–55 / 56–75 / 76–100」，左闭右开下等价于上界 25/45/56/76。
export const FGI_BANDS: readonly Band<FgiRating>[] = [
  { max: 25, key: 'extreme_fear', label: '极度恐惧', text: '恐慌抛售区，情绪极度悲观' },
  { max: 45, key: 'fear', label: '恐惧', text: '谨慎情绪主导' },
  { max: 56, key: 'neutral', label: '中性', text: '多空均衡' },
  { max: 76, key: 'greed', label: '贪婪', text: '追涨情绪升温' },
  { max: Infinity, key: 'extreme_greed', label: '极度贪婪', text: '风险累积区' },
]

/** 仪表扇区绘制用：真实阈值，不是五等分。修 D1。 */
export const FGI_THRESHOLDS = [25, 45, 56, 76] as const

// ---------- M3 VXN：15/20/25/35/50 ----------
export const VXN_BANDS: readonly Band<VxnState>[] = [
  { max: 15, key: 'very_low', label: '极低', text: '市场自满，尾部风险定价不足' },
  { max: 20, key: 'low', label: '低', text: '波动率低位，趋势环境友好' },
  { max: 25, key: 'normal', label: '正常', text: '常态区间' },
  { max: 35, key: 'elevated', label: '偏高', text: '波动率高于常态，风险溢价抬升' },
  { max: 50, key: 'high', label: '高', text: '市场承压' },
  { max: Infinity, key: 'extreme', label: '极高', text: '危机模式' },
]

// ---------- M4 估值百分位：25/75/90 ----------
export const PE_BANDS: readonly Band<ValuationState>[] = [
  { max: 25, key: 'cheap', label: '低估', text: '历史低位，估值提供安全边际' },
  { max: 75, key: 'fair', label: '合理', text: '接近中位，估值不构成主要矛盾' },
  { max: 90, key: 'expensive', label: '偏贵', text: '需要盈利增长消化' },
  { max: 101, key: 'very_expensive', label: '高估', text: '均值回归压力大' },
]

// ---------- M5 RSI：30/45/55/70 ----------
export const RSI_BANDS: readonly Band<RsiRating>[] = [
  { max: 30, key: 'oversold', label: '超卖', text: '超跌，关注反弹但不追' },
  { max: 45, key: 'weak', label: '偏弱', text: '动量走弱' },
  { max: 55, key: 'neutral', label: '中性', text: '方向不明' },
  { max: 70, key: 'strong', label: '偏强', text: '动量向上，趋势健康' },
  { max: Infinity, key: 'overbought', label: '超买', text: '短期过热，警惕回调' },
]

// ---------- M6 风险等级：20/35/50/65/80 ----------
// 索引即档位序：0 极高 → 5 低。宏观情景的档位调整靠移动索引实现。
export const RISK_LEVELS: readonly RiskLevel[] = ['极高', '高', '偏高', '中性', '偏低', '低']

export const RISK_BANDS: readonly Band<RiskLevel>[] = [
  { max: 20, key: '极高', label: '极高', text: '仓位 20–45%' },
  { max: 35, key: '高', label: '高', text: '仓位 45–65%' },
  { max: 50, key: '偏高', label: '偏高', text: '仓位 65–75%' },
  { max: 65, key: '中性', label: '中性', text: '仓位 70–80%' },
  { max: 80, key: '偏低', label: '偏低', text: '仓位 80–90%' },
  { max: Infinity, key: '低', label: '低', text: '仓位 90–100%' },
]

/** 风险等级 → 建议仓位区间，PRD-001 §3.7 */
export const POSITION_BY_RISK: Record<RiskLevel, [number, number]> = {
  低: [90, 100],
  偏低: [80, 90],
  中性: [70, 80],
  偏高: [65, 75],
  高: [45, 65],
  极高: [20, 45],
}

/** 档位索引，用于宏观情景的 ±1 调整 */
export function riskIndex(level: RiskLevel): number {
  const i = RISK_LEVELS.indexOf(level)
  return i < 0 ? RISK_LEVELS.length - 1 : i
}

export function clampRiskIndex(i: number): number {
  return Math.min(RISK_LEVELS.length - 1, Math.max(0, i))
}
