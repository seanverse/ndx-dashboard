/**
 * 本地全栈预览：静态站点 + /api/dashboard。
 *
 *   npx tsx scripts/serve.ts          # 需先 npm run build 与 npx tsx scripts/seed.ts
 *   PORT=4000 npx tsx scripts/serve.ts
 *
 * 存在的理由：Vercel 的 `api/*.ts` 路由在本地没有 `vercel dev` 时无法直接跑。
 * 这个服务器复用同一套 server/ 代码，行为与线上一致，可直接用来验收渲染与响应结构。
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { DailyMetrics, LatestSnapshot } from '../shared/types'
import { assembleDashboard } from '../server/assemble'
import { readJson, storeMode } from '../server/store'

const PORT = Number(process.env.PORT ?? 4173)
const DIST = path.resolve(process.cwd(), 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

async function serveStatic(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const rel = pathname === '/' ? '/index.html' : pathname
  const abs = path.join(DIST, decodeURIComponent(rel))
  // 防目录穿越
  if (!abs.startsWith(DIST)) return null
  try {
    const body = await readFile(abs)
    return { body, type: MIME[path.extname(abs)] ?? 'application/octet-stream' }
  } catch {
    // SPA 回退
    try {
      const body = await readFile(path.join(DIST, 'index.html'))
      return { body, type: 'text/html; charset=utf-8' }
    } catch {
      return null
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  if (url.pathname === '/api/dashboard') {
    const [latest, metrics] = await Promise.all([
      readJson<LatestSnapshot>('latest'),
      readJson<DailyMetrics>('metrics'),
    ])
    if (!latest) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'not_ready', hint: '先运行 npx tsx scripts/seed.ts' }))
      return
    }
    const body = assembleDashboard(latest, metrics)
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
    return
  }

  const file = await serveStatic(url.pathname)
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404')
    return
  }
  res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' })
  res.end(file.body)
})

server.listen(PORT, () => {
  console.log(`[serve] http://localhost:${PORT}  （存储模式 ${storeMode()}）`)
})
