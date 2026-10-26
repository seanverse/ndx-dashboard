/**
 * 鉴权：只认 Bearer Token，用定时安全比较。
 * 三条链路共用 CRON_SECRET：
 *   CF Worker Cron → POST /api/collect
 *   Vercel Cron    → GET  /api/daily（平台自动带同一个头）
 *   人工补跑        → 同一个 curl
 */

import type { VercelRequest } from '@vercel/node'
import { timingSafeEqual } from 'node:crypto'

export function checkBearer(req: VercelRequest): boolean {
  const expected = process.env.CRON_SECRET ?? ''
  if (!expected) return false // 未配置即全部拒绝，避免「忘配就敞口」

  const header = req.headers.authorization
  const raw = Array.isArray(header) ? (header[0] ?? '') : (header ?? '')
  const given = raw.startsWith('Bearer ') ? raw.slice(7) : raw

  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function unauthorized(res: { status: (n: number) => { json: (b: unknown) => void } }): void {
  res.status(401).json({ error: 'unauthorized' })
}
