/**
 * GET /api/dashboard —— 前端唯一入口
 *
 * 合并两个 Blob 后现算全部派生值。刻意不在写入侧存计算结果：
 * 只有一份计算实现（shared/compute），metrics 更新后下次请求立即反映，不会出现两份分数打架。
 *
 * 缓存策略（TECH-001 §2.1）：
 *   s-maxage=300          与 15 分钟采集粒度匹配，边缘最多落后 5 分钟
 *   stale-while-revalidate=600  回源期间继续发旧值，避免上游抖动导致白屏
 * 前端刷新周期必须 ≥ 300 s，否则请求会全部穿透到 Function，
 * Edge Requests 会先于其他额度触顶（TECH-001 §4.3）。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { DailyMetrics, LatestSnapshot } from '../shared/types'
import { assembleDashboard } from '../server/assemble'
import { readJson, storeStatus } from '../server/store'

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  // 首访无数据时也要给短缓存，否则前端每 15 秒重试一次会打满 Function 调用
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')

  try {
    const [latest, metrics] = await Promise.all([
      readJson<LatestSnapshot>('latest'),
      readJson<DailyMetrics>('metrics'),
    ])

    if (!latest) {
      const { mode, problems } = storeStatus()
      res.status(503).json({
        error: 'not_ready',
        // 配置错误与「还没有数据」在页面上都表现为未就绪，这里把区别写进响应，便于直接 curl 定位
        hint:
          mode === 'invalid'
            ? `存储未正确配置：${problems.join('；')}`
            : '首次部署后需手动触发 /api/daily 与 /api/collect',
        storage: mode,
      })
      return
    }

    const body = assembleDashboard(latest, metrics)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.status(200).json(body)
  } catch (e) {
    // 不catch的话平台只回一句通用文案，真实原因只留在日志里，前端只能显示「接口返回 500」
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    console.error('[dashboard] failed', e)
    res.setHeader('Cache-Control', 'no-store')
    res.status(500).json({ error: 'internal', message: message.slice(0, 500) })
  }
}
