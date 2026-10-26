/**
 * 统计基元 + HV20 + corr60 + z-score。PRD-001 §3.1 / §3.6 / M8。
 * 全部为纯函数，前端与服务端共用同一份。
 */

export function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

/** 样本标准差（n−1 分母）。序列长度 < 2 返回 null。 */
export function stdev(xs: readonly number[]): number | null {
  if (xs.length < 2) return null
  const m = mean(xs) as number
  let acc = 0
  for (const x of xs) acc += (x - m) ** 2
  return Math.sqrt(acc / (xs.length - 1))
}

/** 对数收益率，长度 = 输入长度 − 1 */
export function logReturns(closes: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1] as number
    const b = closes[i] as number
    if (a > 0 && b > 0) out.push(Math.log(b / a))
  }
  return out
}

/**
 * HV20：最近 n 个对数收益率的标准差 × √252 × 100，单位 %。
 * 需要 closes 至少 n+1 个点。
 */
export function hv(closes: readonly number[], n = 20, periodsPerYear = 252): number | null {
  if (closes.length < n + 1) return null
  const window = closes.slice(closes.length - (n + 1))
  const sd = stdev(logReturns(window))
  return sd === null ? null : sd * Math.sqrt(periodsPerYear) * 100
}

/** 简单涨跌幅 %，基准是 prev；prev 为 0 或非数时返回 null */
export function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null
  return ((cur - prev) / prev) * 100
}

/**
 * z = (x_last − μ) / σ，窗口取最后 window 个点（含当前点）。
 * σ = 0 或样本不足返回 null —— 缺数不得当 0 用，否则 raw 会恒为 50 掩盖异常。
 */
export function zScoreLast(series: readonly number[], window = 60): number | null {
  if (series.length < window) return null
  const win = series.slice(series.length - window)
  const m = mean(win) as number
  const sd = stdev(win)
  if (sd === null || sd === 0) return null
  return ((series[series.length - 1] as number) - m) / sd
}

/** 60 日均值与标准差，供 daily 落盘后核对 z */
export function windowStats(
  series: readonly number[],
  window = 60,
): { mean: number; sd: number } | null {
  if (series.length < window) return null
  const win = series.slice(series.length - window)
  const sd = stdev(win)
  if (sd === null) return null
  return { mean: mean(win) as number, sd }
}

/** Pearson 相关系数。两序列长度须相等且 ≥ 3。 */
export function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length)
  if (n < 3) return null
  const x = a.slice(a.length - n)
  const y = b.slice(b.length - n)
  const mx = mean(x) as number
  const my = mean(y) as number
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx
    const dy = (y[i] as number) - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

/**
 * 两个按日期升序的日线序列求 n 日收益率相关系数。
 * 先按日期取交集再算收益率，避免错位——新浪各接口的交易日历并非完全重合
 * （外汇含周六半天报价、期货含电子盘），直接按索引对齐会算出假相关。
 */
export function rollingCorr(
  a: readonly { date: string; close: number }[],
  b: readonly { date: string; close: number }[],
  n = 60,
): number | null {
  const bMap = new Map(b.map((p) => [p.date, p.close]))
  const pairs: { date: string; x: number; y: number }[] = []
  for (const p of a) {
    const y = bMap.get(p.date)
    if (y !== undefined && Number.isFinite(y) && Number.isFinite(p.close)) {
      pairs.push({ date: p.date, x: p.close, y })
    }
  }
  if (pairs.length < n + 1) return null
  const win = pairs.slice(pairs.length - (n + 1))
  const rx: number[] = []
  const ry: number[] = []
  for (let i = 1; i < win.length; i++) {
    const p0 = win[i - 1] as { x: number; y: number }
    const p1 = win[i] as { x: number; y: number }
    rx.push(Math.log(p1.x / p0.x))
    ry.push(Math.log(p1.y / p0.y))
  }
  return pearson(rx, ry)
}

/** 四舍五入 half-up，PRD-001 §通用约定「取整」。JS Math.round 对正数即 half-up。 */
export function round(value: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(value * f + Number.EPSILON * Math.sign(value) * f) / f
}
