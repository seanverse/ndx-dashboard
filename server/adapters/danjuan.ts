/**
 * 蛋卷指数估值。NDX 的 TTM PE 与历史百分位唯一来源。
 *
 * 陷阱 4：`pe_percentile` 返回 0.3864 意为 38.64%，必须 ×100。
 * 且 `eva_type: "high"` 与 38.64% 分位自相矛盾 —— eva_type 是平台自己的四档标签，
 * 口径不明，不采用；分档一律由本项目的 PE_BANDS 按百分位重算（PRD-001 §3.4）。
 */

import { fetchJson } from './http'

const URL = 'https://danjuanfunds.com/djapi/index_eva/detail/NDX'

interface DanjuanPayload {
  data?: {
    pe?: number
    pe_percentile?: number
    name?: string
    date?: string
  }
  result_code?: number
}

export interface PeResult {
  peTTM: number
  /** 已换算为 0–100 */
  percentile: number
  /** 蛋卷标注的估值日期 MM-DD，仅供展示 */
  date: string
}

export async function fetchPe(): Promise<PeResult> {
  const raw = await fetchJson<DanjuanPayload>(URL, {
    headers: { Referer: 'https://danjuanfunds.com/' },
    timeoutMs: 10000,
    retries: 2,
  })

  if (raw.result_code !== 0) throw new Error(`蛋卷 result_code=${raw.result_code}`)

  const pe = raw.data?.pe
  const pct = raw.data?.pe_percentile
  if (typeof pe !== 'number' || !Number.isFinite(pe) || pe <= 0) {
    throw new Error('蛋卷响应缺有效 pe')
  }
  if (typeof pct !== 'number' || !Number.isFinite(pct)) {
    throw new Error('蛋卷响应缺 pe_percentile')
  }

  // 接口历史上给出过 0–1 小数与 0–100 两种口径，按量级判断而非硬编码 ×100
  const percentile = pct <= 1 ? pct * 100 : pct

  return { peTTM: pe, percentile, date: String(raw.data?.date ?? '') }
}
