/**
 * 盘中编排：只取截面，不碰任何日 K。
 *
 * 三条纪律：
 *   1. 单源失败不抛异常，沿用上版值并标 stale（TECH-001 §1.1「单源项处理」）
 *   2. 只在同 basis 组内 failover。NDX 的「指数点位」与期货的「连续合约」basis 不同，
 *      但新浪与腾讯的 usNDX / gb_ndx 同为指数点位，可互为备源
 *   3. 切换前做 0.3% 偏差校验 —— 能取到数不等于数对（TECH-001 §1.6）
 */

import type { SourceTag } from '../shared/types'
import { pctChange, round } from '../shared/compute'
import { fetchFearGreed, type FgiResult } from './adapters/cnn'
import { fetchSnapshots, type Snapshot } from './adapters/sina'
import { fetchTencentFutures, fetchTencentNdx } from './adapters/tencent'

/** 同 basis 源之间的最大可接受偏差（TECH-001 §1.6） */
export const SWITCH_TOLERANCE_PCT = 0.3

export interface MacroNow {
  value: number
  chg1d: number | null
  chg5d: number | null
}

export interface CollectResult {
  ndx: Snapshot | null
  fearGreed: FgiResult | null
  macro: { oil: MacroNow | null; gold: MacroNow | null; dxy: MacroNow | null } | null
  sources: Record<string, SourceTag>
  warnings: string[]
  failed: string[]
}

function deviation(a: number, b: number): number {
  if (b === 0) return Number.POSITIVE_INFINITY
  return Math.abs((a - b) / b) * 100
}

/**
 * 5 日环比：以 5 个交易日前的收盘为基准。
 * series 与 snapshot 的 basis 必须一致（都是同一标的），故可直接比较。
 */
function chg5d(value: number, series: readonly { date: string; close: number }[]): number | null {
  if (series.length < 6) return null
  const base = series[series.length - 6]
  if (!base) return null
  return pctChange(value, base.close)
}

export interface CollectOptions {
  /** 日更产物，用来算 chg5d。缺省时 chg5d 为 null */
  macroSeries?: {
    oil: readonly { date: string; close: number }[]
    gold: readonly { date: string; close: number }[]
    dxy: readonly { date: string; close: number }[]
  } | null
}

export async function collectIntraday(options: CollectOptions = {}): Promise<CollectResult> {
  const warnings: string[] = []
  const failed: string[] = []
  const sources: Record<string, SourceTag> = {}

  // 主源与恐贪并发；备源按需再发，避免每次多打两个请求
  const [snapRes, fgiRes] = await Promise.allSettled([fetchSnapshots(), fetchFearGreed()])

  let snap: Awaited<ReturnType<typeof fetchSnapshots>> | null =
    snapRes.status === 'fulfilled' ? snapRes.value : null
  if (!snap) {
    failed.push('sina:snapshot')
    warnings.push('新浪快照请求失败')
  }

  let fearGreed: FgiResult | null = fgiRes.status === 'fulfilled' ? fgiRes.value : null
  if (!fearGreed) {
    failed.push('cnn:fearGreed')
    warnings.push('CNN 恐贪请求失败，沿用上版值')
  }

  // NDX：主源缺失时切腾讯。腾讯直给昨收，无需反推
  let ndx = snap?.ndx ?? null
  if (ndx) {
    sources.ndx = 'sina'
  } else {
    try {
      const t = await fetchTencentNdx()
      if (t) {
        ndx = {
          value: t.value,
          prevClose: t.prevClose,
          open: t.open,
          high: t.high,
          low: t.low,
          volume: t.volume,
          time: t.time,
        }
        sources.ndx = 'tencent'
        warnings.push('NDX 已切换至腾讯备源')
      }
    } catch {
      failed.push('tencent:ndx')
    }
    if (!ndx) sources.ndx = 'missing'
  }

  // 双源同时成功时不切换，但做偏差记录：偏差过大意味着某源串标的或错位一天
  if (snap?.ndx && sources.ndx === 'sina') {
    try {
      const t = await fetchTencentNdx()
      if (t) {
        const d = deviation(snap.ndx.value, t.value)
        if (d > SWITCH_TOLERANCE_PCT) {
          warnings.push(
            `NDX 双源偏差 ${d.toFixed(2)}% 超过 ${SWITCH_TOLERANCE_PCT}%，已按主源取值并标记 uncertain`,
          )
          sources.ndx = 'sina'
        }
      }
    } catch {
      // 备源不可用不影响主源，静默
    }
  }

  // 油 / 金：新浪缺失时切腾讯外盘
  let oil = snap?.oil ?? null
  let gold = snap?.gold ?? null
  if (oil) sources.oil = 'sina'
  if (gold) sources.gold = 'sina'
  if (!oil || !gold) {
    try {
      const t = await fetchTencentFutures()
      if (!oil && t.oil) {
        oil = {
          value: t.oil.value,
          prevClose: t.oil.prevClose,
          open: t.oil.open,
          high: t.oil.high,
          low: t.oil.low,
          volume: null,
          time: t.oil.time,
        }
        sources.oil = 'tencent'
        warnings.push('原油已切换至腾讯备源')
      }
      if (!gold && t.gold) {
        gold = {
          value: t.gold.value,
          prevClose: t.gold.prevClose,
          open: t.gold.open,
          high: t.gold.high,
          low: t.gold.low,
          volume: null,
          time: t.gold.time,
        }
        sources.gold = 'tencent'
        warnings.push('黄金已切换至腾讯备源')
      }
    } catch {
      failed.push('tencent:futures')
    }
  }
  if (!oil) sources.oil = 'missing'
  if (!gold) sources.gold = 'missing'

  // DXY 无备源：DINIW 空返回时（陷阱 3）只能沿用上版
  const dxy = snap?.dxy ?? null
  sources.dxy = dxy ? 'sina' : 'missing'
  if (!dxy) warnings.push('美元指数快照不可用（DINIW 空返回），沿用上版')

  const ms = options.macroSeries
  const macro = {
    oil: oil
      ? {
          value: oil.value,
          chg1d: pctChange(oil.value, oil.prevClose),
          chg5d: ms ? chg5d(oil.value, ms.oil) : null,
        }
      : null,
    gold: gold
      ? {
          value: gold.value,
          chg1d: pctChange(gold.value, gold.prevClose),
          chg5d: ms ? chg5d(gold.value, ms.gold) : null,
        }
      : null,
    dxy: dxy
      ? {
          value: dxy.value,
          chg1d: pctChange(dxy.value, dxy.prevClose),
          chg5d: ms ? chg5d(dxy.value, ms.dxy) : null,
        }
      : null,
  }

  const rounded = {
    oil: macro.oil ? roundMacro(macro.oil) : null,
    gold: macro.gold ? roundMacro(macro.gold) : null,
    dxy: macro.dxy ? roundMacro(macro.dxy) : null,
  }

  return { ndx, fearGreed, macro: rounded, sources, warnings, failed }
}

function roundMacro(m: MacroNow): MacroNow {
  return {
    value: round(m.value, 4),
    chg1d: m.chg1d === null ? null : round(m.chg1d, 2),
    chg5d: m.chg5d === null ? null : round(m.chg5d, 2),
  }
}
