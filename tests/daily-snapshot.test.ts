/**
 * 日快照的契约测试。
 *
 * 两条线：
 *   1 体积 —— 快照必须只留当日增量，不能把上游长序列复制进来。这条断了，
 *     一年后会变成 8 MB 的副本堆，且没有任何测试会报错，只能靠断言提前锁住。
 *   2 结论 —— verdict 是日后复盘「当时系统说了什么」的唯一凭据，宁可缺不可错。
 *     三道闸门（交易日一致 / 非 stale / 已收盘）任何一道失效都会写入假历史。
 */

import { describe, expect, it } from 'vitest'
import type { DailyMetrics, DashboardResponse, Meta, Point, ScoreDims } from '../shared/types'
import { buildDailySnapshot } from '../server/snapshot'
import { dailyPath } from '../server/store'

const day = (d: string, close: number): Point => ({ date: d, close })

/** 三条历史点足够验证「有没有被剥掉」，不需要真实长度 */
const tail: Point[] = [day('2026-10-21', 100), day('2026-10-22', 101), day('2026-10-23', 102)]

function metrics(over: Partial<DailyMetrics> = {}): DailyMetrics {
  return {
    tradeDate: '2026-10-23',
    generatedAt: '2026-10-23T21:00:00.000Z',
    rsi: { rsi6: 55.1, rsi12: 54.2, rsi24: 52.8, mean: 54.03 },
    hv20: 18.76,
    macroSeries: { oil: tail, gold: tail, dxy: tail, ndx: tail },
    macroStats: {
      window: 60,
      oil: { mean: 72.4, sd: 5.1 },
      gold: { mean: 2710.2, sd: 88.3 },
      dxy: { mean: 98.1, sd: 1.42 },
    },
    vxn: { close: 18.2, prevClose: 18.9, change: -0.7, changePct: -3.7, ma20: 19.1, series: tail },
    pe: { peTTM: 31.52, percentile: 78.4 },
    dxyCheck: {
      calculated: 98.42,
      official: 98.45,
      deviationPct: 0.03,
      tolerancePct: 0.05,
      sameSession: true,
      ok: true,
    },
    failedSources: [],
    ...over,
  }
}

function view(over: Partial<Meta> = {}, withBlocks = true): DashboardResponse {
  return {
    meta: {
      symbol: 'NDX',
      tradeDate: '2026-10-23',
      generatedAt: '2026-10-23T21:55:00.000Z',
      delayMinutes: 15,
      quoteAt: '2026-10-23T20:00:00.000Z',
      stale: false,
      phase: 'post',
      sources: {},
      warnings: [],
      ...over,
    },
    quote: null,
    fearGreed: null,
    vxn: null,
    valuation: null,
    rsi: null,
    macro: null,
    score: withBlocks
      ? {
          model: 'v1.0',
          health: 62,
          stars: 3.5,
          riskLevel: '偏高',
          dims: {
            sentiment: 10,
            volatility: -10,
            valuation: -30,
            momentum: 20,
          } satisfies ScoreDims,
          weights: { valuation: 0.25 },
          riskBump: 0,
        }
      : null,
    advice: withBlocks
      ? { ruleId: 'R3', position: [65, 75], longTerm: [], newMoney: [], momentumHint: '' }
      : null,
  }
}

describe('buildDailySnapshot 体积', () => {
  it('剥离上游长序列，不复制 macroSeries 与 vxn.series', () => {
    const snap = buildDailySnapshot(metrics(), null)
    expect(snap).not.toHaveProperty('macroSeries')
    expect(snap.vxn).not.toHaveProperty('series')
    expect(Object.keys(snap.vxn).sort()).toEqual(['change', 'changePct', 'close', 'ma20', 'prevClose'])
  })

  it('单日载荷小于 1 KB，十年不到 4 MB', () => {
    const snap = buildDailySnapshot(metrics(), view())
    const bytes = Buffer.byteLength(JSON.stringify(snap), 'utf8')
    expect(bytes).toBeLessThan(1024)
  })

  it('保留不可重算的事实：PE 分位、DXY 校验、失败源', () => {
    const snap = buildDailySnapshot(metrics({ failedSources: ['cboe:vxn'] }), null)
    expect(snap.pe.percentile).toBe(78.4)
    expect(snap.dxyCheck?.sameSession).toBe(true)
    expect(snap.dxyCheck?.tolerancePct).toBe(0.05)
    expect(snap.failedSources).toEqual(['cboe:vxn'])
  })
})

describe('verdict 三道闸门', () => {
  it('交易日一致且已收盘时记录结论', () => {
    const v = buildDailySnapshot(metrics(), view()).verdict
    expect(v).toEqual({
      model: 'v1.0',
      health: 62,
      stars: 3.5,
      riskLevel: '偏高',
      ruleId: 'R3',
      position: [65, 75],
    })
  })

  it('phase=closed 同样记录（凌晨补跑也有效）', () => {
    expect(buildDailySnapshot(metrics(), view({ phase: 'closed' })).verdict).not.toBeNull()
  })

  it('交易日不一致时记 null，避免把前一天的结论写成今天', () => {
    expect(buildDailySnapshot(metrics(), view({ tradeDate: '2026-10-22' })).verdict).toBeNull()
  })

  it('stale 时记 null，沿用上一版的价算不出有意义的档位', () => {
    expect(buildDailySnapshot(metrics(), view({ stale: true })).verdict).toBeNull()
  })

  it('盘中与盘前记 null，瞬时结论不能冒充当日定稿', () => {
    expect(buildDailySnapshot(metrics(), view({ phase: 'open' })).verdict).toBeNull()
    expect(buildDailySnapshot(metrics(), view({ phase: 'pre' })).verdict).toBeNull()
  })

  it('没有可用截面或评分缺失时记 null，但快照本身照写', () => {
    expect(buildDailySnapshot(metrics(), null).verdict).toBeNull()
    const noScore = buildDailySnapshot(metrics(), view({}, false))
    expect(noScore.verdict).toBeNull()
    expect(noScore.tradeDate).toBe('2026-10-23')
    expect(noScore.rsi.rsi6).toBe(55.1)
  })
})

describe('分片路径', () => {
  it('按 tradeDate 一天一个对象，不随写入次数变化', () => {
    expect(dailyPath('2026-10-23')).toBe('daily/2026-10-23.json')
  })
})
