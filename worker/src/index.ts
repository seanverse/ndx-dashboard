/// <reference types="@cloudflare/workers-types" />
/**
 * CF Worker Cron —— 只当闹钟。
 *
 * 分工的唯一依据（TECH-001 §5.1）：Worker 有 1 分钟粒度的 Cron 但只有 10 ms CPU；
 * Vercel Function 有 300 s 且 IO 等待不计 CPU 但 Hobby Cron 每天只能 1 次。
 * 所以这里只发一个 POST 就结束，抓取 / 计算 / 存储全在 Vercel。
 *
 * 等待 HTTP 响应的时间不计入 CPU，实测单次 < 3 ms（上限 10 ms）。
 */

interface Env {
  ORIGIN: string
  CRON_SECRET: string
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const t0 = Date.now()

    if (!env.ORIGIN || !env.CRON_SECRET) {
      console.error(JSON.stringify({ ok: false, err: 'ORIGIN 或 CRON_SECRET 未配置' }))
      return
    }

    try {
      const res = await fetch(`${env.ORIGIN.replace(/\/$/, '')}/api/collect`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.CRON_SECRET}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(20_000),
      })

      const text = await res.text()
      console.log(
        JSON.stringify({
          ok: res.ok,
          status: res.status,
          ms: Date.now() - t0,
          // 截断到 180 字符：日志按行计费，完整 payload 没有必要
          body: text.slice(0, 180),
        }),
      )
    } catch (e) {
      // cron 失败没有重试机制，只能靠日志。wrangler tail 或 CF 控制台可见
      console.error(JSON.stringify({ ok: false, ms: Date.now() - t0, err: String(e).slice(0, 200) }))
    }
  },

  /** 供手工验证：GET /?dry=1 直接回显配置是否就绪，不发请求 */
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.searchParams.get('dry') === '1') {
      return Response.json({
        ready: Boolean(env.ORIGIN && env.CRON_SECRET),
        origin: env.ORIGIN ?? null,
        cron: '*/15 * * * *',
      })
    }
    return new Response('POST 由 Cron Trigger 自动发起；手工触发请访问 Vercel 的 /api/collect', {
      status: 200,
    })
  },
}
