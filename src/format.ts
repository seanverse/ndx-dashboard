/**
 * 展示格式化。规则来自 PRD-001 §通用计算约定：
 *   价格 2 位 / 百分比 2 位 / 指数点位 2 位 / PE 2 位 / RSI 3 位
 *   half-up 四舍五入
 *   缺数显示 —，不得显示 0
 */

const DASH = '—'

function halfUp(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** 指数点位（千分位） */
export function fmtPoint(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return DASH
  return halfUp(x, digits).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtNum(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return DASH
  return halfUp(x, digits).toFixed(digits)
}

export function fmtInt(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return DASH
  return Math.round(x).toLocaleString('en-US')
}

/**
 * 带符号百分比。
 * |x| < 0.005 时归零，避免出现 "-0.00%" —— 指数平盘时 -0.004% 会被格式化成负零，
 * 与「涨红跌绿」的语义色冲突。
 */
export function fmtPct(x: number | null | undefined, digits = 2, withSign = true): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return DASH
  const v = Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x
  const body = halfUp(v, digits).toFixed(digits)
  if (!withSign) return `${body}%`
  return `${v > 0 ? '+' : ''}${body}%`
}

/** 涨跌语义。A 股习惯：涨红跌绿 */
export type Tone = 'up' | 'down' | 'flat'

export function toneOf(x: number | null | undefined): Tone {
  if (x === null || x === undefined || !Number.isFinite(x)) return 'flat'
  if (x > 0.004) return 'up'
  if (x < -0.004) return 'down'
  return 'flat'
}

export const toneClass: Record<Tone, string> = {
  up: 'text-[var(--color-up)]',
  down: 'text-[var(--color-down)]',
  flat: 'text-[var(--color-muted)]',
}

/** 成交量：亿股口径，与参考图一致（口径存疑见 PRD D6，此处只做单位换算） */
export function fmtVolume(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return DASH
  if (x >= 1e8) return `${halfUp(x / 1e8, 2)} 亿股`
  if (x >= 1e4) return `${halfUp(x / 1e4, 2)} 万股`
  return `${Math.round(x)} 股`
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return DASH
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return DASH
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const PHASE_TEXT: Record<string, string> = {
  pre: '盘前',
  open: '盘中',
  post: '收盘定稿',
  closed: '休市',
}

/**
 * 数据新鲜度文案。
 * 盘中给「上游快照延迟」，其余时段给「距该交易日收盘多久」——
 * 后者在周末会到 4 位数分钟，直接写「延迟 15 分钟」是错的。
 */
export function freshnessText(meta: { phase: string; tradeDate: string; delayMinutes: number }): string {
  if (meta.phase === 'open') return `延迟约 ${meta.delayMinutes} 分钟`
  const d = Math.max(0, meta.delayMinutes)
  if (d < 60) return `${meta.tradeDate} 收盘 · ${d} 分钟前`
  if (d < 60 * 24) return `${meta.tradeDate} 收盘 · ${Math.round(d / 60)} 小时前`
  const days = Math.round(d / (60 * 24))
  return `${meta.tradeDate} 收盘 · ${days} 天前`
}
