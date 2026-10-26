/**
 * 生成本地数据快照，供前端预览与联调。
 *
 *   npx tsx scripts/seed.ts
 *
 * 产物落在 .data/latest.json 与 .data/metrics.json，格式与线上 Blob 完全一致，
 * 因此预览看到的渲染结果就是线上结果。
 */

import type { LatestSnapshot } from '../shared/types'
import { etTradeDate, tradingPhase } from '../server/calendar'
import { assembleDashboard } from '../server/assemble'
import { buildDaily } from '../server/series'
import { collectIntraday } from '../server/sources'
import { readJson, storeMode, writeJson } from '../server/store'

async function main() {
  const t0 = Date.now()
  console.log(`[seed] 存储模式：${storeMode()}`)

  console.log('[seed] 日更…')
  const { metrics, log } = await buildDaily()
  await writeJson('metrics', metrics, { cacheControlMaxAge: 3600 })
  console.log(
    `[seed] metrics 已写入：tradeDate=${metrics.tradeDate} rsi6=${metrics.rsi.rsi6} vxn=${metrics.vxn.close} pe=${metrics.pe.peTTM}/${metrics.pe.percentile}% dxyCheck=${JSON.stringify(metrics.dxyCheck)}`,
  )
  if (log.length) for (const l of log) console.log(`  ! ${l}`)

  console.log('[seed] 盘中采集…')
  const collected = await collectIntraday({ macroSeries: metrics.macroSeries })
  console.log(`[seed] sources=${JSON.stringify(collected.sources)}`)

  const now = new Date()
  const latest: LatestSnapshot = {
    meta: {
      symbol: 'NDX',
      tradeDate: etTradeDate(now),
      generatedAt: now.toISOString(),
      delayMinutes: 15,
      quoteAt: now.toISOString(),
      stale: collected.ndx === null,
      phase: tradingPhase(now),
      sources: {
        ...collected.sources,
        fearGreed: collected.fearGreed ? 'cnn' : 'missing',
        vxn: 'cboe',
        pe: 'danjuan',
        rsi: 'calc',
      },
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

  await writeJson('latest', latest, { cacheControlMaxAge: 60 })

  // 回读校验：确保落盘内容能被正常装配
  const back = await readJson<LatestSnapshot>('latest')
  const view = assembleDashboard(back ?? latest, metrics)
  console.log(
    `[seed] latest 已写入并回读校验：health=${view.score?.health} stars=${view.score?.stars} risk=${view.score?.riskLevel} position=${view.advice?.position.join('-')}%`,
  )
  console.log(`[seed] 完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

main().catch((e) => {
  console.error('[seed] 失败：', e)
  process.exit(1)
})
