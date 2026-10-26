/**
 * CBOE VXN 日线。唯一可用源，无免费备源。
 *
 * 两个必须知道的点：
 *   1. cdn.cboe.com 会 307 跳到 cdn-api.cboe.com。fetch 默认跟随，但直接打后者少一次往返；
 *      前者保留为 fallback，以防边缘节点分流策略变化。
 *   2. 文件约 4,300 行 / 220 KB，日期格式 MM/DD/YYYY。**不要放进盘中任务**，
 *      解析成本会吃掉 Workers 的 10 ms 预算（TECH-001 §4.2）。
 */

import { fetchText } from './http'

const URLS = [
  'https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv',
  'https://cdn.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv',
]

export interface VxnSeries {
  series: { date: string; close: number }[]
  /** 最新收盘 */
  close: number
  /** 前一交易日收盘 */
  prevClose: number
  /** 最近 20 个交易日收盘均值 */
  ma20: number
}

/** MM/DD/YYYY → YYYY-MM-DD */
function toIso(mdY: string): string | null {
  const m = mdY.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[1]}-${m[2]}`
}

export function parseVxnCsv(text: string): VxnSeries {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 21) throw new Error(`VXN CSV 行数不足：${lines.length}`)

  const series: { date: string; close: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    if (i === 0 && /date/i.test(line)) continue // 表头
    const parts = line.split(',')
    const date = toIso(parts[0] ?? '')
    const close = Number(parts[4])
    if (!date || !Number.isFinite(close) || close <= 0) continue
    series.push({ date, close })
  }

  if (series.length < 21) throw new Error(`VXN 有效行数不足：${series.length}`)
  series.sort((a, b) => a.date.localeCompare(b.date))

  const last = series[series.length - 1] as { date: string; close: number }
  const prev = series[series.length - 2] as { date: string; close: number }
  const win = series.slice(-20)
  const ma20 = win.reduce((s, p) => s + p.close, 0) / win.length

  return { series, close: last.close, prevClose: prev.close, ma20 }
}

export async function fetchVxn(): Promise<VxnSeries> {
  let lastErr: unknown
  for (const url of URLS) {
    try {
      const { text } = await fetchText(url, { timeoutMs: 30000, retries: 2 })
      if (!/^DATE,/i.test(text.trim())) throw new Error('响应不是 CSV（陷阱 6）')
      return parseVxnCsv(text)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('VXN 全部端点失败')
}
