/**
 * 实连验证（M0-b 的执行工具）。
 *
 * 默认跳过，需显式开启：
 *   RUN_LIVE=1 npm run check:sources
 *
 * 用途有两个：
 *   1. 验证各适配器在**当前网络环境**下能否取到数据 —— 这就是「出口 IP 是否可达」的判据
 *   2. 用真实数据跑一遍完整链路，产出 DashboardResponse，核对分档与评分是否落在合理区间
 *
 * 在本地 VPS 通过、在 Vercel Function 失败，说明该源对海外 IP 不友好，采集层必须落地国内。
 */

import { describe, expect, it } from 'vitest'
import { assembleDashboard } from '../server/assemble'
import { etTradeDate, isTradingWindow, tradingPhase } from '../server/calendar'
import { computeDxy } from '../server/dxy'
import { fetchVxn } from '../server/adapters/cboe'
import { fetchFearGreed } from '../server/adapters/cnn'
import { fetchPe } from '../server/adapters/danjuan'
import { fetchAllFx } from '../server/adapters/forex'
import { fetchFuturesDaily, fetchNdxDaily, fetchSnapshots } from '../server/adapters/sina'
import { fetchTencentFutures, fetchTencentNdx } from '../server/adapters/tencent'
import { buildDaily } from '../server/series'
import { collectIntraday } from '../server/sources'
import type { LatestSnapshot } from '../shared/types'

const LIVE = process.env.RUN_LIVE === '1'

describe.skipIf(!LIVE)('live sources', () => {
  it('新浪快照：四标的全通', async () => {
    const s = await fetchSnapshots()
    console.log('[sina snapshot]', JSON.stringify(s, null, 2))
    expect(s.ndx).not.toBeNull()
    expect(s.ndx!.value).toBeGreaterThan(10000)
    // 昨收必须是反推出来的，且与现价同量级
    expect(s.ndx!.prevClose).toBeGreaterThan(10000)
    expect(s.oil!.value).toBeGreaterThan(1)
    expect(s.gold!.value).toBeGreaterThan(100)
    expect(s.dxy!.value).toBeGreaterThan(50)
    expect(s.dxy!.value).toBeLessThan(150)
  }, 30_000)

  it('腾讯备源：usNDX 与 hf_CL/hf_GC 可用，usCL 不得被误用', async () => {
    const ndx = await fetchTencentNdx()
    console.log('[tencent ndx]', JSON.stringify(ndx))
    expect(ndx).not.toBeNull()
    expect(ndx!.value).toBeGreaterThan(10000)

    const f = await fetchTencentFutures()
    console.log('[tencent futures]', JSON.stringify(f))
    // 原油必须是期货价（10–200 美元/桶），不能是高露洁的 90–100 美元/股
    // 两者价位接近，因此额外校验：新浪与腾讯的原油偏差应 < 0.5%
    if (f.oil) {
      const sina = await fetchSnapshots()
      if (sina.oil) {
        const dev = Math.abs((f.oil.value - sina.oil.value) / sina.oil.value) * 100
        console.log(`[oil cross-check] tencent=${f.oil.value} sina=${sina.oil.value} dev=${dev.toFixed(3)}%`)
        expect(dev).toBeLessThan(0.5)
      }
    }
  }, 30_000)

  it('CNN 恐贪：score 在 0–100，七子指标齐全', async () => {
    const f = await fetchFearGreed()
    console.log('[cnn]', JSON.stringify(f, null, 2))
    expect(f.score).toBeGreaterThanOrEqual(0)
    expect(f.score).toBeLessThanOrEqual(100)
    expect(f.components.length).toBe(7)
  }, 30_000)

  it('蛋卷 PE：百分位已换算到 0–100', async () => {
    const pe = await fetchPe()
    console.log('[danjuan]', JSON.stringify(pe))
    expect(pe.peTTM).toBeGreaterThan(5)
    expect(pe.percentile).toBeGreaterThan(0)
    expect(pe.percentile).toBeLessThanOrEqual(100)
  }, 30_000)

  it('CBOE VXN：CSV 行数 ≥ 4000，末行日期为近期', async () => {
    const v = await fetchVxn()
    console.log('[cboe]', { close: v.close, prevClose: v.prevClose, ma20: v.ma20, last: v.series.at(-1) })
    expect(v.series.length).toBeGreaterThan(4000)
    expect(v.close).toBeGreaterThan(5)
    expect(v.close).toBeLessThan(150)
  }, 60_000)

  it('新浪日 K：NDX / CL / GC 根数达标且按日期升序', async () => {
    const [ndx, oil, gold] = await Promise.all([
      fetchNdxDaily(),
      fetchFuturesDaily('CL'),
      fetchFuturesDaily('GC'),
    ])
    console.log('[dailyK]', {
      ndx: `${ndx.length} bars ${ndx[0]?.date} → ${ndx.at(-1)?.date}`,
      oil: `${oil.length} bars ${oil[0]?.date} → ${oil.at(-1)?.date}`,
      gold: `${gold.length} bars ${gold[0]?.date} → ${gold.at(-1)?.date}`,
    })
    expect(ndx.length).toBeGreaterThan(3000)
    expect(oil.length).toBeGreaterThan(5000)
    expect(gold.length).toBeGreaterThan(2000)
    for (const bars of [ndx, oil, gold]) {
      for (let i = 1; i < bars.length; i++) {
        expect((bars[i] as { date: string }).date >= (bars[i - 1] as { date: string }).date).toBe(true)
      }
    }
  }, 60_000)

  it('六货币对 + DXY 自算：偏差 ≤ 0.05%', async () => {
    const [fx, snap] = await Promise.all([fetchAllFx(), fetchSnapshots()])
    const dxy = computeDxy(fx)
    console.log('[dxy]', {
      pairs: dxy.pairCount,
      missing: dxy.missingPairs,
      bars: dxy.series.length,
      first: dxy.series[0],
      last: dxy.series.at(-1),
      official: snap.dxy?.value,
    })
    expect(dxy.pairCount).toBe(6)
    expect(dxy.series.length).toBeGreaterThan(3000)
    if (snap.dxy) {
      const calc = dxy.series.at(-1)!.close
      const dev = Math.abs((calc - snap.dxy.value) / snap.dxy.value) * 100
      console.log(`[dxy check] calc=${calc.toFixed(4)} official=${snap.dxy.value} dev=${dev.toFixed(4)}%`)
      expect(dev).toBeLessThan(0.05)
    }
  }, 90_000)

  it('完整日更链路', async () => {
    const { metrics, log } = await buildDaily()
    console.log('[daily]', JSON.stringify({ ...metrics, macroSeries: '[omitted]', vxn: { ...metrics.vxn, series: '[omitted]' } }, null, 2))
    if (log.length) console.log('[daily log]', log)
    expect(metrics.tradeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(metrics.rsi.rsi6).toBeGreaterThan(0)
    expect(metrics.rsi.rsi6).toBeLessThan(100)
    expect(metrics.vxn.close).toBeGreaterThan(0)
    expect(metrics.pe.percentile).toBeGreaterThan(0)
    expect(metrics.macroSeries.dxy.length).toBeGreaterThan(60)
  }, 180_000)

  it('完整盘中链路 + 装配：输出结构完整且分档自洽', async () => {
    const { metrics } = await buildDaily()
    const collected = await collectIntraday({ macroSeries: metrics.macroSeries })
    console.log('[collect]', JSON.stringify({ sources: collected.sources, warnings: collected.warnings, failed: collected.failed }))

    const latest: LatestSnapshot = {
      meta: {
        symbol: 'NDX',
        tradeDate: etTradeDate(),
        generatedAt: new Date().toISOString(),
        delayMinutes: 15,
        quoteAt: new Date().toISOString(),
        stale: collected.ndx === null,
        phase: tradingPhase(),
        sources: collected.sources,
        warnings: collected.warnings,
      },
      quote: collected.ndx
        ? {
            close: collected.ndx.value,
            prevClose: collected.ndx.prevClose,
            open: collected.ndx.open,
            high: collected.ndx.high,
            low: collected.ndx.low,
            volume: collected.ndx.volume,
          }
        : null,
      fearGreed: collected.fearGreed
        ? {
            score: collected.fearGreed.score,
            rating: 'neutral',
            prevClose: collected.fearGreed.prevClose,
            oneWeek: collected.fearGreed.oneWeek,
            oneMonth: collected.fearGreed.oneMonth,
            oneYear: collected.fearGreed.oneYear,
            components: collected.fearGreed.components.map((c) => ({
              key: c.key,
              label: c.key,
              score: c.score,
              rating: c.rating,
            })),
          }
        : null,
      macroNow: collected.macro,
    }

    const view = assembleDashboard(latest, metrics)
    console.log(
      '[dashboard]',
      JSON.stringify(
        {
          meta: view.meta,
          quote: view.quote,
          fearGreed: view.fearGreed && { score: view.fearGreed.score, rating: view.fearGreed.rating },
          vxn: view.vxn,
          valuation: view.valuation,
          rsi: view.rsi,
          macro: view.macro && { composite: view.macro.composite, oil: view.macro.oil, gold: view.macro.gold, dxy: view.macro.dxy },
          score: view.score,
          advice: view.advice,
        },
        null,
        2,
      ),
    )

    expect(view.quote).not.toBeNull()
    expect(view.quote!.change).toBeCloseTo(view.quote!.close - view.quote!.prevClose, 6)
    expect(view.score).not.toBeNull()
    expect(view.score!.health).toBeGreaterThanOrEqual(0)
    expect(view.score!.health).toBeLessThanOrEqual(100)
    expect([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]).toContain(view.score!.stars)
    expect(view.advice).not.toBeNull()
    expect(view.advice!.position).toHaveLength(2)
    if (view.macro) {
      expect(view.macro.composite.mps).toBeGreaterThanOrEqual(0)
      expect(view.macro.composite.mps).toBeLessThanOrEqual(100)
    }
  }, 240_000)

  it('交易日历与时段判定', () => {
    console.log('[calendar]', {
      now: new Date().toISOString(),
      tradeDate: etTradeDate(),
      phase: tradingPhase(),
      window: isTradingWindow(),
    })
    expect(etTradeDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
