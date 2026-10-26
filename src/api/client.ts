import { useQuery } from '@tanstack/react-query'
import type { DashboardResponse } from '../../shared/types'

export class NotReadyError extends Error {
  constructor() {
    super('数据准备中')
    this.name = 'NotReadyError'
  }
}

async function fetchDashboard(signal?: AbortSignal): Promise<DashboardResponse> {
  const res = await fetch('/api/dashboard', { signal, headers: { Accept: 'application/json' } })
  if (res.status === 503) throw new NotReadyError()
  if (!res.ok) throw new Error(`接口返回 ${res.status}`)
  return (await res.json()) as DashboardResponse
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
