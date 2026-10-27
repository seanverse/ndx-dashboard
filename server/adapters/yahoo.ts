/**
 * Yahoo Finance chart API。2026-10-27 起为盘中快照主源。
 *
 * 为什么换：采集跑在 Vercel（美国出口），新浪 hq.sinajs.cn 从该出口间歇性失败
 * （上线首日实测采集中全灭，同一分钟日更链的新浪 vip 域名却正常，说明是 hq 主机
 * 对海外出口的策略而非全线封禁）。Yahoo chart API 同一出口实测 ^NDX / CL=F / GC=F /
 * DX-Y.NYB 全 200，且 DX-Y.NYB 是 ICE 美元指数现货，与六货币对自算的 basis 一致
 * （同日交叉偏差 0.003%）。
 *
 * 注意：
 *   - chart API 不支持多符号，四标的各一次请求、并发打
 *   - previousClose 优先于 chartPreviousClose（后者随 range 变化）
 *   - 指数 volume 是成分股合计（口径偏差 D6，与新浪一致）
 *   - Yahoo 对数据中心共享出口可能限流（429/999）：本层失败返回 null，
 *     由调用方切备源（腾讯 NDX / 油 / 金，新浪 DINIW）
 *   - Stooq 已死（404）、CNBC 对代理出口 403，均于 2026-10-27 实测排除
 */

import { fetchJson } from './http.js'

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/'

export const YAHOO_SYMBOLS = {
  ndx: '^NDX',
  oil: 'CL=F',
  gold: 'GC=F',
  dxy: 'DX-Y.NYB',
} as const

export type YahooKey = keyof typeof YAHOO_SYMBOLS

export interface YahooQuote {
  symbol: string
  value: number
  prevClose: number
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  /** epoch 秒 */
  time: number | null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 纯解析，供单测。缺价 / 缺昨收 / 结构不对一律 null，由调用方走备源 */
export function parseYahooChart(json: unknown): YahooQuote | null {
  const meta = (json as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } })
    ?.chart?.result?.[0]?.meta
  if (!meta) return null

  const value = num(meta.regularMarketPrice)
  const prevClose = num(meta.previousClose) ?? num(meta.chartPreviousClose)
  if (value === null || prevClose === null) return null

  return {
    symbol: typeof meta.symbol === 'string' ? meta.symbol : '',
    value,
    prevClose,
    open: num(meta.regularMarketOpen),
    high: num(meta.regularMarketDayHigh),
    low: num(meta.regularMarketDayLow),
    volume: num(meta.regularMarketVolume),
    time: num(meta.regularMarketTime),
  }
}

/** 单标的快照。任何失败都返回 null 而不是抛——主源失败切备源是常态路径 */
export async function fetchYahooQuote(symbol: string): Promise<YahooQuote | null> {
  try {
    const json = await fetchJson(`${BASE}${encodeURIComponent(symbol)}?range=1d&interval=15m`)
    return parseYahooChart(json)
  } catch {
    return null
  }
}

export type YahooSnapshots = Record<YahooKey, YahooQuote | null>

/**
 * 四标的并发。lean（extended 节奏）时 NDX 不会动，跳过它的请求，4 → 3。
 */
export async function fetchYahooSnapshots(opts: { lean?: boolean } = {}): Promise<YahooSnapshots> {
  const wanted: YahooKey[] = opts.lean
    ? ['oil', 'gold', 'dxy']
    : (Object.keys(YAHOO_SYMBOLS) as YahooKey[])
  const entries = await Promise.all(
    wanted.map(async (key) => [key, await fetchYahooQuote(YAHOO_SYMBOLS[key])] as const),
  )
  const out: YahooSnapshots = { ndx: null, oil: null, gold: null, dxy: null }
  for (const [key, q] of entries) out[key] = q
  return out
}
