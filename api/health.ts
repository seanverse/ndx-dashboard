/**
 * GET /api/health —— 部署自检
 *
 * 存在的理由：配置错误与「还没有数据」在页面上都表现为加载失败/未就绪，
 * 而平台默认的 500 只回一句通用文案，排查要翻日志才知道缺什么。
 * 这个端点把每一步独立跑一遍，返回「哪一步、缺什么、实际命中了哪些变量名」，
 * 一次请求就能定位。
 *
 * 不返回任何凭证值，只返回变量名与是否存在。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { DailyMetrics, LatestSnapshot } from '../shared/types.js'
import { describeEnv, readJson, storeStatus } from '../server/store.js'

interface Check {
  step: string
  ok: boolean
  detail?: unknown
  error?: string
}

function errText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  return String(e)
}

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')

  const checks: Check[] = []

  checks.push({
    step: 'runtime',
    ok: true,
    detail: {
      node: process.version,
      region: process.env.VERCEL_REGION ?? null,
      onVercel: Boolean(process.env.VERCEL),
      now: new Date().toISOString(),
    },
  })

  try {
    const status = storeStatus()
    checks.push({ step: 'store_status', ok: status.mode !== 'invalid', detail: status })
  } catch (e) {
    checks.push({ step: 'store_status', ok: false, error: errText(e) })
  }

  try {
    checks.push({ step: 'env', ok: true, detail: describeEnv() })
  } catch (e) {
    checks.push({ step: 'env', ok: false, error: errText(e) })
  }

  try {
    const latest = await readJson<LatestSnapshot>('latest')
    checks.push({
      step: 'read_latest',
      ok: latest !== null,
      detail: latest
        ? {
            tradeDate: latest.meta.tradeDate,
            generatedAt: latest.meta.generatedAt,
            phase: latest.meta.phase,
            stale: latest.meta.stale,
          }
        : '对象不存在或读取失败；若 store_status 为 invalid 则是配置问题，否则是尚未灌数',
    })
  } catch (e) {
    checks.push({ step: 'read_latest', ok: false, error: errText(e) })
  }

  try {
    const metrics = await readJson<DailyMetrics>('metrics')
    checks.push({
      step: 'read_metrics',
      ok: metrics !== null,
      detail: metrics
        ? {
            tradeDate: metrics.tradeDate,
            generatedAt: metrics.generatedAt,
            failedSources: metrics.failedSources,
          }
        : '对象不存在或读取失败；若 store_status 为 invalid 则是配置问题，否则是尚未执行 /api/daily',
    })
  } catch (e) {
    checks.push({ step: 'read_metrics', ok: false, error: errText(e) })
  }

  res.status(200).json({
    ok: checks.every((c) => c.ok),
    at: new Date().toISOString(),
    checks,
  })
}
