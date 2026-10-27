import { useQuery } from '@tanstack/react-query'
import type { DashboardResponse } from '../../shared/types'

export class NotReadyError extends Error {
  constructor() {
    super('数据准备中')
    this.name = 'NotReadyError'
  }
}

/** 服务端返回了可读原因时带上来，供页面直接显示，不必再去翻日志 */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface ErrorBody {
  error?: string
  hint?: string
  message?: string
  storage?: string
}

export async function fetchDashboard(signal?: AbortSignal): Promise<DashboardResponse> {
  const res = await fetch('/api/dashboard', { signal, headers: { Accept: 'application/json' } })
  const raw = await res.text()

  let body: ErrorBody | null = null
  if (raw) {
    try {
      body = JSON.parse(raw) as ErrorBody
    } catch {
      // 非 JSON（平台层错误页、网关文案等），原样截一段用于显示
    }
  }

  // 存储配置错误与「还没灌数据」都是 503，但前者需要人去改配置，不能混进「准备中」
  if (res.status === 503 && body?.storage !== 'invalid') throw new NotReadyError()

  if (!res.ok) {
    const detail = body?.message ?? body?.hint ?? raw.slice(0, 300)
    throw new ApiError(detail ? `${res.status} · ${detail}` : `接口返回 ${res.status}`, res.status)
  }

  if (!body) throw new ApiError('接口返回空响应体', res.status)
  return body as DashboardResponse
}

/**
 * 刷新周期 15 分钟，与服务端 s-maxage=300 匹配。
 * 轮询快于缓存 TTL 会让请求全部穿透到 Function，Edge Requests 会先于其他额度触顶
 * （TECH-001 §4.3）。数据本身 15 分钟才变一次，此处不会漏更。
 */
export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: ({ signal }) => fetchDashboard(signal),
    refetchInterval: 15 * 60 * 1000,
    staleTime: 10 * 60 * 1000,
    // 503「数据准备中」属于预期状态，不重试刷屏
    retry: (count, err) => !(err instanceof NotReadyError) && count < 2,
    retryDelay: 5000,
  })
}
