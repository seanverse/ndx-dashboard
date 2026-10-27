/**
 * 腾讯适配器：仅作备源。三个已核实的可用标的，另有三个必须避开的坑。
 *
 * 可用：
 *   usNDX   ~ 分隔，[3] 现价 [4] 昨收 [5] 今开 [6] 成交量 [31] 时间
 *   hf_CL   ~ 分隔，与新浪 hf_ 同格式
 *   hf_GC   同上
 *
 * 必须避开（陷阱 2 / 3）：
 *   usCL    返回高露洁 CL.N（97 美元/股），不是原油期货
 *   whDXY   返回 pnone_match
 *   fx_sdxy 返回空串
 */

import { fetchText, numField, strField } from './http.js'

const BASE = 'https://qt.gtimg.cn/q='

export interface TencentQuote {
  value: number
  /** 腾讯美股接口直给昨收 —— 比新浪少一步反推，是本源唯一的结构性优势 */
  prevClose: number
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  time: string
}

interface RawBlock {
  code: string
  parts: string[]
}

/** 导出仅为单测：两套返回格式的差异是历史 bug 来源，必须可回归 */
export function parseBlocks(text: string, codes: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const code = line.slice(0, eq).replace(/^v_/, '').trim()
    if (!codes.includes(code)) continue
    const q1 = line.indexOf('"')
    const q2 = line.lastIndexOf('"')
    const body = q1 >= 0 && q2 > q1 ? line.slice(q1 + 1, q2) : ''
    if (!body) continue

    // 期货（hf_）与美股是两套格式：期货是逗号分隔且没有状态位前缀，
    // 美股才带 `200~`。早期统一按 200~ 校验，导致 hf_CL/hf_GC 永远解析成 null
    // —— 备源看着有、实际从未生效。
    if (code.startsWith('hf_')) {
      const parts = body.split(',')
      if (parts.length < 13) continue
      out.set(code, parts)
      continue
    }

    if (!body.startsWith('200~')) continue
    out.set(code, body.split('~'))
  }
  return out
}

async function fetchBlocks(codes: string[]): Promise<Map<string, string[]>> {
  const { text } = await fetchText(`${BASE}${codes.join(',')}`, {
    timeoutMs: 8000,
    retries: 2,
    encoding: 'gbk',
  })
  return parseBlocks(text, codes)
}

function toQuote(p: string[], kind: 'us' | 'hf'): TencentQuote | null {
  if (kind === 'us') {
    const value = numField(p, 3)
    const prevClose = numField(p, 4)
    if (value === null || prevClose === null || value <= 0 || prevClose <= 0) return null
    return {
      value,
      prevClose,
      open: numField(p, 5),
      high: numField(p, 33) ?? null,
      low: numField(p, 34) ?? null,
      volume: numField(p, 6),
      time: strField(p, 30),
    }
  }
  const value = numField(p, 0)
  const prevClose = numField(p, 7)
  if (value === null || prevClose === null || value <= 0 || prevClose <= 0) return null
  return {
    value,
    prevClose,
    open: numField(p, 8),
    high: numField(p, 4),
    low: numField(p, 5),
    volume: null,
    time: `${strField(p, 12)} ${strField(p, 6)}`.trim(),
  }
}

/** NDX 备源。返回 null 表示该源本次不可用，由上层沿用上版并标 stale。 */
export async function fetchTencentNdx(): Promise<TencentQuote | null> {
  const m = await fetchBlocks(['usNDX'])
  const p = m.get('usNDX')
  return p ? toQuote(p, 'us') : null
}

export async function fetchTencentFutures(): Promise<{
  oil: TencentQuote | null
  gold: TencentQuote | null
}> {
  const m = await fetchBlocks(['hf_CL', 'hf_GC'])
  const oil = m.get('hf_CL')
  const gold = m.get('hf_GC')
  return {
    oil: oil ? toQuote(oil, 'hf') : null,
    gold: gold ? toQuote(gold, 'hf') : null,
  }
}

export type { RawBlock }
