/**
 * 前端错误呈现：500 时必须带上服务端给的原因，而不是只说「接口返回 500」。
 *
 * 这一层很容易在后续改动中退化——把非 503 一律抛成固定文案，页面就又变成
 * 只显示一个状态码，排查只能去翻 Function 日志。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NotReadyError, fetchDashboard } from '../src/api/client'

function stubFetch(status: number, body: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchDashboard 错误呈现', () => {
  it('500 时把服务端的 message 带出来', async () => {
    stubFetch(500, JSON.stringify({ error: 'internal', message: 'TypeError: boom' }))
    await expect(fetchDashboard()).rejects.toBeInstanceOf(ApiError)
    await expect(fetchDashboard()).rejects.toThrow(/500 · TypeError: boom/)
  })

  it('503 且存储配置无效时，显示配置提示而不是「准备中」', async () => {
    stubFetch(
      503,
      JSON.stringify({ error: 'not_ready', storage: 'invalid', hint: '存储未正确配置：缺少 BLOB_BASE_URL' }),
    )
    await expect(fetchDashboard()).rejects.toThrow(/缺少 BLOB_BASE_URL/)
  })

  it('503 且只是还没灌数时，仍按「准备中」处理', async () => {
    stubFetch(503, JSON.stringify({ error: 'not_ready', storage: 'blob' }))
    await expect(fetchDashboard()).rejects.toBeInstanceOf(NotReadyError)
  })

  it('响应体不是 JSON 时，截取原文而不是丢掉', async () => {
    stubFetch(502, 'upstream connect failed')
    await expect(fetchDashboard()).rejects.toThrow(/502 · upstream connect failed/)
  })
})
