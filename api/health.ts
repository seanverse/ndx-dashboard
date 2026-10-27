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
import { PATHS, describeEnv, probeBlobObject, readJson, storeStatus } from '../server/store.js'

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

    // 空库时 read_latest 只能是 null，「域名写错」和「还没灌数」看起来完全一样，
    // 所以这里单独要一次状态码：404 说明基址正确、只是没数据；连不上说明基址写错。
    if (status.mode === 'blob') {
      const probe = await probeBlobObject(PATHS.latest)
      const reading =
        probe.status === 200
          ? '对象存在，基址正确'
          : probe.status === 404
            ? '基址可达、对象尚不存在（正常：还没灌数）'
            : probe.status === 403
              ? '基址可达但被拒绝：库可能是 Private，或域名指向了别的库'
              : probe.status === null
                ? '连不上：域名拼错，或该 Blob 库不存在'
                : `返回 ${probe.status}：检查基址是否指向本项目的 Blob 库`
      checks.push({
        step: 'blob_probe',
        ok: probe.status === 200 || probe.status === 404,
        detail: { url: probe.url, status: probe.status, reading, ...(probe.error ? { error: probe.error } : {}) },
      })
    } else {
      checks.push({
        step: 'blob_probe',
        ok: false,
        detail: `存储模式为 ${status.mode}，跳过探测：先修好 store_status 的 problems`,
      })
    }
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
