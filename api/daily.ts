/**
 * GET /api/daily —— 日更（由 Vercel Cron 每天 22:00 UTC 触发）
 *
 * 为什么放 Vercel 而不是 Workers：这一步要解析 NDX 180 KB、CL 450 KB、六货币对 46 万字符 × 6，
 * 必然超过 Workers 的 10 ms CPU 预算；Vercel Function 有 300 s，IO 等待不计 CPU。
 *
 * 为什么放 Vercel 而不是 GitHub Actions：Hobby 的 cron 上限是「每天 1 次」，日更本身就是每天 1 次，
 * 额度刚好咬住需求，不引入第二个平台。
 *
 * 落两份：metrics.json（覆盖写，只留最新）+ data/daily/YYYY-MM-DD.json（追加写，历史）。
 * 后者是唯一的跨日凭据——覆盖写每天都会抹掉前一天，不写分片就等于每天主动丢一份历史。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { DailyMetrics } from '../shared/types.js'
import { checkBearer, unauthorized } from '../server/auth.js'
import { etTradeDate } from '../server/calendar.js'
import { buildDaily } from '../server/series.js'
import { tryWriteDailySnapshot } from '../server/snapshot.js'
import { readJson, writeJson } from '../server/store.js'

/** Hobby 上限即 300 s，显式声明避免平台默认值把它压低 */
export const maxDuration = 300

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const t0 = Date.now()

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  if (!checkBearer(req)) return unauthorized(res)

  const now = new Date()
  const today = etTradeDate(now)

  // 幂等：按 tradeDate 比对，不看时间戳。同日重复触发直接返回
  const prev = await readJson<DailyMetrics>('metrics')
  if (prev?.tradeDate === today) {
    // metrics 已是当日。若上次快照写失败，这里补一次，避免历史留下永久空洞
    const snapshot = await tryWriteDailySnapshot(prev, now)
    return res.status(200).json({ skipped: 'already-done', tradeDate: today, snapshot })
  }

  try {
    const { metrics, log } = await buildDaily(now)

    // NDX 日 K 末根还没更新到今天（时区 / 上游延迟）时，不覆盖上一版，
    // 否则会用昨天的序列覆盖掉已经正确的当期指标
    if (prev && metrics.tradeDate < prev.tradeDate) {
      return res.status(200).json({
        skipped: 'upstream-not-ready',
        upstreamTradeDate: metrics.tradeDate,
        existingTradeDate: prev.tradeDate,
      })
    }

    await writeJson('metrics', metrics, { cacheControlMaxAge: 3600 })
    const snapshot = await tryWriteDailySnapshot(metrics, now)

    return res.status(200).json({
      ok: true,
      tradeDate: metrics.tradeDate,
      rsi: metrics.rsi,
      hv20: metrics.hv20,
      vxn: metrics.vxn.close,
      pe: metrics.pe,
      dxyCheck: metrics.dxyCheck,
      failedSources: metrics.failedSources,
      snapshot,
      log,
      ms: Date.now() - t0,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[daily] failed', msg)
    return res.status(500).json({ error: 'daily_failed', message: msg.slice(0, 300), ms: Date.now() - t0 })
  }
}
