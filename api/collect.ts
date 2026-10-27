/**
 * POST /api/collect —— 盘中采集（由 CF Worker Cron 每 15 分钟触发）
 *
 * 七步，每步都有明确理由：
 *   1 鉴权        防止端点被外部刷，触发上游限流
 *   2 时段闸门    非交易时段的空数据会覆盖好缓存
 *   3 幂等        手动补跑 / 部署窗口双触发时挡住，不消耗 Blob 写
 *   4 日更兜底    Vercel Cron 不重试，metrics 落后时在这里顺带补跑
 *   5 抓取        单源失败不抛，沿用上版并标 stale
 *   6 组装        只存截面原料，派生值留给 /api/dashboard 现算
 *   7 写入        覆盖写固定路径
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { DailyMetrics, LatestSnapshot, Meta, SourceTag } from '../shared/types'
import { assembleDashboard } from '../server/assemble'
import { checkBearer, unauthorized } from '../server/auth'
import { etTradeDate, isTradingWindow, prevTradeDate, tradingPhase } from '../server/calendar'
import { buildDaily } from '../server/series'
import { tryWriteDailySnapshot } from '../server/snapshot'
import { collectIntraday } from '../server/sources'
import { readJson, writeJson } from '../server/store'

/** 两次写入的最小间隔。CF Cron 是 15 分钟，8 分钟可容一次重试而不会双写 */
const MIN_INTERVAL_MS = 8 * 60_000

async function collect(req: VercelRequest, res: VercelResponse) {
  const t0 = Date.now()

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!checkBearer(req)) return unauthorized(res)

  const now = new Date()

  // 2 时段闸门：用 Intl 按 America/New_York 判断，规避 DST
  if (!isTradingWindow(now)) {
    return res.status(200).json({ skipped: 'off-hours', phase: tradingPhase(now) })
  }

  const prev = await readJson<LatestSnapshot>('latest')

  // 3 幂等
  if (prev) {
    const age = now.getTime() - Date.parse(prev.meta.generatedAt)
    if (Number.isFinite(age) && age < MIN_INTERVAL_MS) {
      return res.status(200).json({ skipped: 'too-soon', ageSeconds: Math.round(age / 1000) })
    }
  }

  // 4 日更兜底
  let metrics = await readJson<DailyMetrics>('metrics')
  const phase = tradingPhase(now)
  const today = etTradeDate(now)
  const expectedTradeDate = phase === 'open' || phase === 'pre' ? prevTradeDate(today) : today
  const dailyBehind = !metrics || metrics.tradeDate < expectedTradeDate
  let dailyRetried = false

  if (dailyBehind) {
    try {
      const built = await buildDaily(now)
      metrics = built.metrics
      await writeJson('metrics', metrics, { cacheControlMaxAge: 3600 })
      // 盘中补跑出来的指标不是当日定稿：PE 分位、VXN 收盘价都还没定格，
      // 写成日快照会把「上午的水平」永久记成「当天的收盘水平」。收盘后再记。
      if (phase === 'post' || phase === 'closed') {
        await tryWriteDailySnapshot(metrics, now)
      }
      dailyRetried = true
    } catch (e) {
      // 日更补跑失败不阻断盘中：指标维度会缺，评分权重重分配，warning 里留痕
      console.error('[collect] daily retry failed', String(e).slice(0, 200))
    }
  }

  // 5 抓取
  const collected = await collectIntraday({ macroSeries: metrics?.macroSeries ?? null })

  // 6 组装 LatestSnapshot（只放截面原料）
  const warnings = [...collected.warnings]
  if (dailyBehind && !dailyRetried) warnings.push('日更失败，VXN / 估值 / RSI 可能落后')
  if (metrics?.failedSources.length) warnings.push(`日更缺源：${metrics.failedSources.join(', ')}`)

  const sources: Record<string, SourceTag> = { ...collected.sources }
  if (collected.fearGreed) sources.fearGreed = 'cnn'
  if (metrics) {
    sources.vxn = 'cboe'
    sources.pe = 'danjuan'
    sources.rsi = 'calc'
    sources.dxyHistory = 'calc'
  }

  const ndx = collected.ndx
  const quote = ndx
    ? {
        close: ndx.value,
        prevClose: ndx.prevClose,
        open: ndx.open,
        high: ndx.high,
        low: ndx.low,
        volume: ndx.volume,
      }
    : (prev?.quote ?? null)

  const stale = ndx === null
  const meta: Meta = {
    symbol: 'NDX',
    tradeDate: today,
    generatedAt: now.toISOString(),
    delayMinutes: 15,
    quoteAt: now.toISOString(),
    stale,
    phase,
    sources,
    warnings,
  }

  const payload: LatestSnapshot = {
    meta,
    quote,
    fearGreed: collected.fearGreed
      ? {
          score: collected.fearGreed.score,
          rating: 'neutral', // 分档由 assemble 重算，此处占位
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
      : (prev?.fearGreed ?? null),
    macroNow: collected.macro ?? prev?.macroNow ?? null,
  }

  // 全源失败：不写 Blob，保留上一版，返回 200 让 cron 不告警刷屏
  if (stale && !payload.fearGreed && !payload.macroNow) {
    return res.status(200).json({ skipped: 'all-sources-down', ms: Date.now() - t0 })
  }

  // 7 写入
  await writeJson('latest', payload, { cacheControlMaxAge: 60 })

  // 附带一次装配，让响应能直接看出计算结果（不落盘，仅便于 curl 校验）
  const view = assembleDashboard(payload, metrics, { now })

  return res.status(200).json({
    ok: true,
    tradeDate: view.meta.tradeDate,
    stale,
    dailyRetried,
    health: view.score?.health ?? null,
    stars: view.score?.stars ?? null,
    riskLevel: view.score?.riskLevel ?? null,
    sources,
    warnings: view.meta.warnings,
    failed: collected.failed,
    ms: Date.now() - t0,
  })
}

/**
 * 未捕获异常统一转成可读的 500。
 * 之前写盘失败（例如 Blob 未配置）会直接冒到平台层，只回一句通用错误，
 * 前端拿不到任何线索，只能看到「接口返回 500」。
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await collect(req, res)
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    console.error('[collect] failed', e)
    if (res.headersSent) return
    res.setHeader('Cache-Control', 'no-store')
    res.status(500).json({ error: 'collect_failed', message: message.slice(0, 500) })
  }
}
