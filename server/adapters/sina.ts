/**
 * 新浪适配器：唯一四标的全通的源，定为主源。
 * 三个接口三种格式（陷阱 5），因此拆成三个独立解析函数，不共用一个「万能解析器」。
 *
 *   快照      hq.sinajs.cn/list=...        GBK，逗号分隔，需 Referer
 *   美股日K   US_MinKService.getDailyK     JSON 数组 {d,o,h,l,c,v}
 *   期货日K   GlobalFuturesDailyKLine      JSONP，{date,open,high,low,close,...}
 */

import { fetchJson, fetchText, numField, strField, unwrapJsonp } from './http'

const SINA_REFERER = { Referer: 'https://finance.sina.com.cn/' }

export interface Snapshot {
  /** 最新价 */
  value: number
  /** 昨收。新浪美股接口不提供，由 现价 − 涨跌额 反推（陷阱 1） */
  prevClose: number
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  /** 上游时间字符串，仅用于展示 */
  time: string
}

export interface DailyBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

/**
 * 字段序（实测，不得凭记忆改）：
 *   gb_ndx  0 名称 1 现价 2 涨跌幅% 3 时间 4 涨跌额 5 今开 6 最高 7 最低 8 52周高 9 52周低 10 成交量
 *   hf_CL   0 现价 4 最高 5 最低 6 时间 7 昨收 8 今开 12 日期 13 名称
 *   DINIW   0 时间 1 现价 5 昨收 6 最高 7 最低 10 日期
 */
const LIST = 'gb_ndx,hf_CL,hf_GC,DINIW'

function splitLines(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).replace(/^var\s+hq_str_/, '').trim()
    const q1 = line.indexOf('"')
    const q2 = line.lastIndexOf('"')
    const body = q1 >= 0 && q2 > q1 ? line.slice(q1 + 1, q2) : ''
    out.set(key, body.split(','))
  }
  return out
}

function parseUsSnapshot(parts: string[]): Snapshot | null {
  const value = numField(parts, 1)
  const delta = numField(parts, 4)
  if (value === null || delta === null || value <= 0) return null
  const prevClose = value - delta
  if (prevClose <= 0) return null
  return {
    value,
    prevClose,
    open: numField(parts, 5),
    high: numField(parts, 6),
    low: numField(parts, 7),
    volume: numField(parts, 10),
    time: strField(parts, 3),
  }
}

function parseFuturesSnapshot(parts: string[]): Snapshot | null {
  const value = numField(parts, 0)
  const prevClose = numField(parts, 7)
  if (value === null || prevClose === null || value <= 0 || prevClose <= 0) return null
  return {
    value,
    prevClose,
    open: numField(parts, 8),
    high: numField(parts, 4),
    low: numField(parts, 5),
    volume: null,
    time: strField(parts, 12) ? `${strField(parts, 12)} ${strField(parts, 6)}` : strField(parts, 6),
  }
}

function parseDxySnapshot(parts: string[]): Snapshot | null {
  const value = numField(parts, 1)
  const prevClose = numField(parts, 5)
  if (value === null || prevClose === null || value <= 0 || prevClose <= 0) return null
  return {
    value,
    prevClose,
    open: null,
    high: numField(parts, 6),
    low: numField(parts, 7),
    volume: null,
    time: strField(parts, 0),
  }
}

export interface AllSnapshots {
  ndx: Snapshot | null
  oil: Snapshot | null
  gold: Snapshot | null
  dxy: Snapshot | null
}

/** 一次请求拿四个标的。任一标的是空串（如 fx_sdxy 陷阱 3）时该项为 null，不抛整批。 */
export async function fetchSnapshots(): Promise<AllSnapshots> {
  const { text } = await fetchText(`https://hq.sinajs.cn/list=${LIST}`, {
    headers: SINA_REFERER,
    timeoutMs: 8000,
    retries: 2,
    encoding: 'gbk',
  })

  const m = splitLines(text)
  const ndx = m.get('gb_ndx')
  const oil = m.get('hf_CL')
  const gold = m.get('hf_GC')
  const dxy = m.get('DINIW')

  return {
    ndx: ndx ? parseUsSnapshot(ndx) : null,
    oil: oil ? parseFuturesSnapshot(oil) : null,
    gold: gold ? parseFuturesSnapshot(gold) : null,
    dxy: dxy ? parseDxySnapshot(dxy) : null,
  }
}

interface RawUsBar {
  d?: string
  o?: string
  h?: string
  l?: string
  c?: string
  v?: string
}

/**
 * 美股日 K。返回按日期升序的完整序列。
 * 注意：盘中末根 close 是当前未收盘价（陷阱 8），本函数不剔除，由 series 层按需处理。
 */
export async function fetchNdxDaily(): Promise<DailyBar[]> {
  const url =
    'https://stock.finance.sina.com.cn/usstock/api/json_v2.php/' +
    'US_MinKService.getDailyK?symbol=.NDX&___qn=3'
  const raw = await fetchJson<RawUsBar[]>(url, {
    headers: SINA_REFERER,
    timeoutMs: 15000,
    retries: 2,
  })
  if (!Array.isArray(raw) || raw.length < 30) {
    throw new Error(`NDX 日K 根数异常：${Array.isArray(raw) ? raw.length : 'not-array'}`)
  }
  const bars: DailyBar[] = []
  for (const b of raw) {
    const close = Number(b.c)
    const open = Number(b.o)
    const high = Number(b.h)
    const low = Number(b.l)
    const date = String(b.d ?? '')
    if (!date || !Number.isFinite(close) || close <= 0) continue
    bars.push({
      date,
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
      volume: Number.isFinite(Number(b.v)) && b.v ? Number(b.v) : null,
    })
  }
  bars.sort((a, z) => a.date.localeCompare(z.date))
  return bars
}

interface RawFuturesBar {
  date?: string
  open?: string
  high?: string
  low?: string
  close?: string
  volume?: string
}

/** 期货日 K（CL / GC）。JSONP 包裹，两根 7691 / 2590。 */
export async function fetchFuturesDaily(symbol: 'CL' | 'GC'): Promise<DailyBar[]> {
  const url =
    'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20t=/' +
    `GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${symbol}`
  const { text } = await fetchText(url, {
    headers: SINA_REFERER,
    timeoutMs: 20000,
    retries: 2,
  })
  const raw = JSON.parse(unwrapJsonp(text)) as RawFuturesBar[]
  if (!Array.isArray(raw) || raw.length < 30) {
    throw new Error(`${symbol} 日K 根数异常：${Array.isArray(raw) ? raw.length : 'not-array'}`)
  }
  const bars: DailyBar[] = []
  for (const b of raw) {
    const date = String(b.date ?? '')
    const close = Number(b.close)
    if (!date || !Number.isFinite(close) || close <= 0) continue
    bars.push({
      date,
      open: Number(b.open) || close,
      high: Number(b.high) || close,
      low: Number(b.low) || close,
      close,
      volume: Number(b.volume) || null,
    })
  }
  bars.sort((a, z) => a.date.localeCompare(z.date))
  return bars
}
