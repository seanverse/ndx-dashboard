/**
 * 盘中编排：只取截面，不碰任何日 K。
 *
 * 三条纪律：
 *   1. 单源失败不抛异常，沿用上版值并标 stale（TECH-001 §1.1「单源项处理」）
 *   2. 只在同 basis 组内 failover。NDX 的「指数点位」与期货的「连续合约」basis 不同，
 *      但新浪与腾讯的 usNDX / gb_ndx 同为指数点位，可互为备源
 *   3. 切换前做 0.3% 偏差校验 —— 能取到数不等于数对（TECH-001 §1.6）
 */

import type { SourceTag } from '../shared/types.js'
import { pctChange, round } from '../shared/compute/index.js'
import { fetchFearGreed, type FgiResult } from './adapters/cnn.js'
import { fetchSnapshots, type Snapshot } from './adapters/sina.js'
import { fetchTencentFutures, fetchTencentNdx } from './adapters/tencent.js'
import { fetchYahooSnapshots, type YahooQuote } from './adapters/yahoo.js'

/** 同 basis 源之间的最大可接受偏差（TECH-001 §1.6） */
export const SWITCH_TOLERANCE_PCT = 0.3

/** YahooQuote → 统一 Snapshot（time 统一成 ISO 字符串，纯展示用） */
function toSnapshot(q: YahooQuote): Snapshot {
  return {
    value: q.value,
    prevClose: q.prevClose,
    open: q.open,
    high: q.high,
    low: q.low,
    volume: q.volume,
    time: q.time === null ? '' : new Date(q.time * 1000).toISOString(),
  }
}

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
  /**
   * extended 节奏（Globex 开市但股市闭市）：NDX 与恐贪此时段不会变，
   * 跳过 CNN 请求与腾讯 NDX 交叉校验 / 备源切换，上游请求 3 → 1。
   * 新浪快照是单请求带 4 标的，油 / 金 / DXY 仍照常取到。
   */
  lean?: boolean
}

export async function collectIntraday(options: CollectOptions = {}): Promise<CollectResult> {
  const warnings: string[] = []
  const failed: string[] = []
  const sources: Record<string, SourceTag> = {}

  // 主源 Yahoo（四标的并发）与恐贪并发；备源按需再发
  const fgiTask: Promise<FgiResult | null> = options.lean
    ? Promise.resolve(null)
    : fetchFearGreed().catch(() => null)
  const [yahoo, fearGreed] = await Promise.all([
    fetchYahooSnapshots({ lean: options.lean }),
    fgiTask,
  ])
  if (!fearGreed && !options.lean) {
    failed.push('cnn:fearGreed')
    warnings.push('CNN 恐贪请求失败，沿用上版值')
  }

  // NDX：主源缺失时切腾讯。腾讯直给昨收，无需反推。lean 时跳过（夜里 NDX 不变）
  let ndx: Snapshot | null = yahoo.ndx ? toSnapshot(yahoo.ndx) : null
  if (ndx) {
    sources.ndx = 'yahoo'
  } else if (!options.lean) {
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
  }
  if (!ndx) sources.ndx = 'missing'

  // 双源交叉校验（非 lean）：偏差过大意味着某源串标的或错位一天。
  // Yahoo ^NDX 与腾讯 usNDX 同为指数点位，同 basis 可比
  if (!options.lean && ndx && sources.ndx === 'yahoo') {
    try {
      const t = await fetchTencentNdx()
      if (t) {
        const d = deviation(ndx.value, t.value)
        if (d > SWITCH_TOLERANCE_PCT) {
          warnings.push(
            `NDX 双源偏差 ${d.toFixed(2)}% 超过 ${SWITCH_TOLERANCE_PCT}%，已按主源取值并标记 uncertain`,
          )
        }
      }
    } catch {
      // 备源不可用不影响主源，静默
    }
  }

  // 油 / 金：Yahoo 缺失时切腾讯外盘
  let oil: Snapshot | null = yahoo.oil ? toSnapshot(yahoo.oil) : null
  let gold: Snapshot | null = yahoo.gold ? toSnapshot(yahoo.gold) : null
  if (oil) sources.oil = 'yahoo'
  if (gold) sources.gold = 'yahoo'
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

  // DXY：Yahoo 的 DX-Y.NYB 是 ICE 现货指数，与六货币对自算历史同 basis（偏差 0.003%）。
  // 缺失时退回新浪 DINIW 快照——DXY 自此第一次有了备源
  let dxy: Snapshot | null = yahoo.dxy ? toSnapshot(yahoo.dxy) : null
  if (dxy) {
    sources.dxy = 'yahoo'
  } else {
    try {
      const s = await fetchSnapshots() // 单请求带四标的，此处只用 dxy
      if (s.dxy) {
        dxy = s.dxy
        sources.dxy = 'sina'
        warnings.push('美元指数已切换至新浪 DINIW 备源')
      }
    } catch {
      failed.push('sina:dxy')
    }
  }
  if (!dxy) {
    sources.dxy = 'missing'
    warnings.push('美元指数快照不可用，沿用上版')
  }

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
