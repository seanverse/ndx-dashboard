/**
 * CNN Fear & Greed。无备源。
 *
 * 口径错配必须记住：CNN 恐贪底层是 S&P 500 体系（子指标用 SPX / VIX / NYSE 广度），
 * 给 NDX 定情绪属代理指标。Phase 1 在 UI 固定标注，Phase 2 才考虑自建 NDX 版。
 */

import { fetchJson } from './http'

const URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata'
const HEADERS = {
  Referer: 'https://edition.cnn.com/',
  Origin: 'https://edition.cnn.com',
}

/** 七个子指标，与 PRD-001 §3.2 的列举顺序一致。sp500 与 sp125 是同一指标的两个端点，取 sp125。 */
const COMPONENT_KEYS = [
  'market_momentum_sp125',
  'stock_price_strength',
  'stock_price_breadth',
  'put_call_options',
  'market_volatility_vix_50',
  'safe_haven_demand',
  'junk_bond_demand',
] as const

interface CnnComponent {
  score?: number
  rating?: string
  data?: { x: number; y: number }[]
}

interface CnnPayload {
  fear_and_greed?: {
    score?: number
    rating?: string
    timestamp?: string
    previous_close?: number
    previous_1_week?: number
    previous_1_month?: number
    previous_1_year?: number
  }
  [k: string]: unknown
}

export interface FgiResult {
  score: number
  rating: string
  timestamp: string
  prevClose: number | null
  oneWeek: number | null
  oneMonth: number | null
  oneYear: number | null
  components: { key: string; score: number; rating: string }[]
}

function optionalNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function fetchFearGreed(): Promise<FgiResult> {
  const raw = await fetchJson<CnnPayload>(URL, {
    headers: HEADERS,
    timeoutMs: 12000,
    retries: 2,
  })

  const fg = raw.fear_and_greed
  const score = optionalNumber(fg?.score)
  if (score === null) throw new Error('CNN 响应缺 fear_and_greed.score')

  const components: { key: string; score: number; rating: string }[] = []
  for (const key of COMPONENT_KEYS) {
    const c = raw[key] as CnnComponent | undefined
    const s = optionalNumber(c?.score)
    if (s === null) continue
    components.push({ key, score: s, rating: String(c?.rating ?? '') })
  }

  return {
    score,
    rating: String(fg?.rating ?? ''),
    timestamp: String(fg?.timestamp ?? ''),
    prevClose: optionalNumber(fg?.previous_close),
    oneWeek: optionalNumber(fg?.previous_1_week),
    oneMonth: optionalNumber(fg?.previous_1_month),
    oneYear: optionalNumber(fg?.previous_1_year),
    components,
  }
}
