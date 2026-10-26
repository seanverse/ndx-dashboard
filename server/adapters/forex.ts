/**
 * 新浪外汇日 K。DXY 自算的输入层（TECH-001 §1.3）。
 *
 * 格式与其他两个接口都不同（陷阱 5）：
 *   返回是竖线分隔的扁平字符串，每段 `date,open,low,high,close,` —— 注意字段序是 O-L-H-C，
 *   不是常见的 OHLC。整段响应约 46 万字符。
 */

import { fetchText, unwrapJsonp } from './http'

export interface FxBar {
  date: string
  open: number
  low: number
  high: number
  close: number
}

/** 六货币对，符号名对应新浪 fx_s<name> */
export const FX_PAIRS = [
  { key: 'EURUSD', symbol: 'fx_seurusd', invert: true },
  { key: 'USDJPY', symbol: 'fx_susdjpy', invert: false },
  { key: 'GBPUSD', symbol: 'fx_sgbpusd', invert: true },
  { key: 'USDCAD', symbol: 'fx_susdcad', invert: false },
  { key: 'USDSEK', symbol: 'fx_susdsek', invert: false },
  { key: 'USDCHF', symbol: 'fx_susdchf', invert: false },
] as const

export type FxKey = (typeof FX_PAIRS)[number]['key']

export function parseForexFlat(text: string): FxBar[] {
  const body = unwrapJsonp(text)
  const inner = body.replace(/^\(|\)$/g, '')
  const bars: FxBar[] = []
  for (const seg of inner.split('|')) {
    const parts = seg.split(',')
    if (parts.length < 5) continue
    const date = (parts[0] ?? '').trim()
    const open = Number(parts[1])
    const low = Number(parts[2])
    const high = Number(parts[3])
    const close = Number(parts[4])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (![open, low, high, close].every((v) => Number.isFinite(v) && v > 0)) continue
    bars.push({ date, open, low, high, close })
  }
  bars.sort((a, b) => a.date.localeCompare(b.date))
  return bars
}

export async function fetchFxDaily(symbol: string): Promise<FxBar[]> {
  const url =
    'https://vip.stock.finance.sina.com.cn/forex/api/jsonp.php/var%20t=/' +
    `NewForexService.getDayKLine?symbol=${symbol}`
  const { text } = await fetchText(url, {
    headers: { Referer: 'https://finance.sina.com.cn/' },
    timeoutMs: 20000,
    retries: 2,
  })
  const bars = parseForexFlat(text)
  if (bars.length < 300) throw new Error(`${symbol} 日K 根数不足：${bars.length}`)
  return bars
}

/** 并发抓六对。任一失败不阻塞其余，由合成层按交集降级。 */
export async function fetchAllFx(): Promise<Partial<Record<FxKey, FxBar[]>>> {
  const results = await Promise.allSettled(
    FX_PAIRS.map(async (p) => ({ key: p.key, bars: await fetchFxDaily(p.symbol) })),
  )
  const out: Partial<Record<FxKey, FxBar[]>> = {}
  for (const r of results) {
    if (r.status === 'fulfilled') out[r.value.key] = r.value.bars
  }
  return out
}
