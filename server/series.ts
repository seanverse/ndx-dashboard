/**
 * 日更编排：一次跑完所有序列型指标，产出 metrics.json。
 *
 * 为什么这些活不能放 Worker（TECH-001 §4.2）：CPU 成本几乎全在 JSON 解析，
 * NDX 日 K 180 KB、CL 日 K 450 KB、六货币对 46 万字符 × 6，必然超过 Workers 的 10 ms。
 * Vercel Function 300 s 的预算对这里是数个数量级的余量。
 *
 * 编排顺序：并发抓取 → 合成 DXY → 算指标 → 校验 → 落盘。
 * 单源失败不阻断整体：缺哪个就少哪个字段，并在 failedSources 留痕。
 */

import type { DailyMetrics, Point } from '../shared/types'
import { hv, pctChange, round, windowStats, zScoreLast } from '../shared/compute'
import { rsi } from '../shared/compute/rsi'
import { closeMomentUtc, etTradeDate } from './calendar'
import { checkDxyDeviation, computeDxy } from './dxy'
import { fetchVxn } from './adapters/cboe'
import { fetchPe } from './adapters/danjuan'
import { fetchAllFx } from './adapters/forex'
import { fetchFuturesDaily, fetchNdxDaily, fetchSnapshots } from './adapters/sina'
import type { DailyBar } from './adapters/sina'

/** 落盘序列保留的尾部长度。60 日 z-score 与 60 日相关性只需 120 天余量。 */
const SERIES_TAIL = 120
/** z-score 窗口，PRD-001 §3.6 */
const Z_WINDOW = 60

function tail(bars: readonly DailyBar[], n = SERIES_TAIL): Point[] {
  return bars.slice(-n).map((b) => ({ date: b.date, close: b.close }))
}

function statsOrNull(series: readonly Point[], window = Z_WINDOW) {
  const closes = series.map((p) => p.close)
  const s = windowStats(closes, window)
  return s === null ? null : { mean: round(s.mean, 6), sd: round(s.sd, 6) }
}

export interface DailyBuildResult {
  metrics: DailyMetrics
  /** 供调用方拼 warning，不落盘 */
  log: string[]
}

export async function buildDaily(now: Date = new Date()): Promise<DailyBuildResult> {
  const log: string[] = []
  const failedSources: string[] = []

  const [ndxRes, oilRes, goldRes, fxRes, vxnRes, peRes, snapRes] = await Promise.allSettled([
    fetchNdxDaily(),
    fetchFuturesDaily('CL'),
    fetchFuturesDaily('GC'),
    fetchAllFx(),
    fetchVxn(),
    fetchPe(),
    fetchSnapshots(),
  ])

  const ndx = ndxRes.status === 'fulfilled' ? ndxRes.value : null
  if (!ndx) {
    failedSources.push('sina:ndxDaily')
    log.push(`NDX 日K 失败：${String((ndxRes as PromiseRejectedResult).reason).slice(0, 120)}`)
  }

  const oil = oilRes.status === 'fulfilled' ? oilRes.value : null
  if (!oil) {
    failedSources.push('sina:oilDaily')
    log.push(`原油日K 失败：${String((oilRes as PromiseRejectedResult).reason).slice(0, 120)}`)
  }

  const gold = goldRes.status === 'fulfilled' ? goldRes.value : null
  if (!gold) {
    failedSources.push('sina:goldDaily')
    log.push(`黄金日K 失败：${String((goldRes as PromiseRejectedResult).reason).slice(0, 120)}`)
  }

  const fx = fxRes.status === 'fulfilled' ? fxRes.value : {}
  if (fxRes.status === 'rejected') {
    failedSources.push('sina:fxDaily')
    log.push(`外汇日K 失败：${String(fxRes.reason).slice(0, 120)}`)
  }

  const vxn = vxnRes.status === 'fulfilled' ? vxnRes.value : null
  if (!vxn) {
    failedSources.push('cboe:vxn')
    log.push(`VXN 失败：${String((vxnRes as PromiseRejectedResult).reason).slice(0, 120)}`)
  }

  const pe = peRes.status === 'fulfilled' ? peRes.value : null
  if (!pe) {
    failedSources.push('danjuan:pe')
    log.push(`PE 失败：${String((peRes as PromiseRejectedResult).reason).slice(0, 120)}`)
  }

  const snap = snapRes.status === 'fulfilled' ? snapRes.value : null
  if (!snap) log.push('快照失败（仅影响 DXY 校验，不影响日更产物）')

  // NDX 日 K 末根日期即数据交易日，比按当前时间推算更可靠
  const ndxLast = ndx?.[ndx.length - 1]
  const tradeDate = ndxLast?.date ?? etTradeDate(now)

  const dxy = computeDxy(fx)
  if (dxy.missingPairs.length > 0) {
    failedSources.push(`fx:${dxy.missingPairs.join('/')}`)
    log.push(`DXY 合成缺 ${dxy.missingPairs.join('/')}，序列不可用`)
  }

  const ndxCloses = (ndx ?? []).map((b) => b.close)
  const r6 = rsi(ndxCloses, 6)
  const r12 = rsi(ndxCloses, 12)
  const r24 = rsi(ndxCloses, 24)
  const mean = r6 !== null && r12 !== null && r24 !== null ? (r6 + r12 + r24) / 3 : null

  const oilSeries = tail(oil ?? [])
  const goldSeries = tail(gold ?? [])
  const ndxSeries = tail(ndx ?? [])

  // L3 校验：自算 DXY 末值 vs 新浪 DINIW 快照
  let dxyCheck: DailyMetrics['dxyCheck'] = null
  const dxyLast = dxy.series[dxy.series.length - 1]
  const officialDxy = snap?.dxy?.value ?? null
  if (dxyLast && officialDxy !== null) {
    // 距该交易日收盘 3 小时内，DINIW 仍是同一时点的收盘价，可用 0.05% 严格容差；
    // 否则（如亚洲时段手动触发）只能做量级校验，避免时间差被误判成数据错。
    const hoursSinceClose = (now.getTime() - closeMomentUtc(dxyLast.date, now).getTime()) / 3_600_000
    const sameSession = hoursSinceClose >= 0 && hoursSinceClose <= 3
    const c = checkDxyDeviation(dxyLast.close, officialDxy, sameSession)
    dxyCheck = {
      calculated: round(dxyLast.close, 4),
      official: round(officialDxy, 4),
      deviationPct: round(c.deviationPct, 4),
      tolerancePct: c.tolerancePct,
      sameSession,
      ok: c.ok,
    }
    if (!c.ok) log.push(`DXY 校验偏差 ${c.deviationPct.toFixed(3)}% 超过 ${c.tolerancePct}% 阈值`)
  }

  const metrics: DailyMetrics = {
    tradeDate,
    generatedAt: new Date().toISOString(),
    rsi: {
      rsi6: r6 === null ? 0 : round(r6, 3),
      rsi12: r12 === null ? 0 : round(r12, 3),
      rsi24: r24 === null ? 0 : round(r24, 3),
      mean: mean === null ? 0 : round(mean, 3),
    },
    hv20: round(hv(ndxCloses, 20) ?? 0, 2),
    macroSeries: {
      oil: oilSeries,
      gold: goldSeries,
      dxy: dxy.series.slice(-SERIES_TAIL).map((p) => ({ date: p.date, close: round(p.close, 4) })),
      ndx: ndxSeries,
    },
    macroStats: {
      window: Z_WINDOW,
      oil: statsOrNull(oilSeries),
      gold: statsOrNull(goldSeries),
      dxy: statsOrNull(dxy.series),
    },
    vxn: {
      close: vxn?.close ?? 0,
      prevClose: vxn?.prevClose ?? 0,
      change: vxn ? round(vxn.close - vxn.prevClose, 2) : 0,
      changePct: vxn ? round(pctChange(vxn.close, vxn.prevClose) ?? 0, 2) : 0,
      ma20: vxn ? round(vxn.ma20, 2) : 0,
      series: vxn ? vxn.series.slice(-SERIES_TAIL) : [],
    },
    pe: { peTTM: pe?.peTTM ?? 0, percentile: pe ? round(pe.percentile, 2) : 0 },
    dxyCheck,
    failedSources,
  }

  return { metrics, log }
}

/** 供 collect 复算 z-score，避免重复实现 */
export { zScoreLast, Z_WINDOW }
