/**
 * HTTP 基元。三条纪律：
 *   1. HTTP 200 ≠ 数据有效（陷阱 6）—— 调用方必须校验字段数 / 数值可比，本层只保证拿到文本
 *   2. 超时用 AbortSignal.timeout，不用自己数秒
 *   3. 重试只对网络类错误，不对 4xx（4xx 重试无意义且会打上游限流）
 */

export interface FetchOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  /** 总尝试次数，默认 1（即不重试）。日更可给 2。 */
  retries?: number
  /** 显式指定解码方式。新浪 hq 接口是 GBK，不给会出乱码但不报错。 */
  encoding?: 'utf-8' | 'gbk'
}

export interface FetchResult {
  status: number
  text: string
  ms: number
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status = 0,
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function decode(buf: ArrayBuffer, encoding: 'utf-8' | 'gbk'): string {
  try {
    return new TextDecoder(encoding).decode(buf)
  } catch {
    // 运行时缺 full-icu 时 TextDecoder('gbk') 会抛错，退回 utf-8 并让上层按字段数校验失败
    return new TextDecoder('utf-8').decode(buf)
  }
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const { headers = {}, timeoutMs = 8000, retries = 1, encoding = 'utf-8' } = opts
  const attempts = Math.max(1, retries)
  let lastErr: unknown

  for (let i = 0; i < attempts; i++) {
    const t0 = Date.now()
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': DEFAULT_UA, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })
      const buf = await res.arrayBuffer()
      const text = decode(buf, encoding)
      if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, url, res.status)
      return { status: res.status, text, ms: Date.now() - t0 }
    } catch (e) {
      lastErr = e
      const status = e instanceof UpstreamError ? e.status : 0
      if (status >= 400 && status < 500) break // 4xx 不重试
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw lastErr instanceof UpstreamError ? lastErr : new UpstreamError(msg, url)
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { text } = await fetchText(url, { ...opts, encoding: opts.encoding ?? 'utf-8' })
  try {
    return JSON.parse(text) as T
  } catch {
    throw new UpstreamError(`非 JSON 响应（前 80 字符）：${text.slice(0, 80)}`, url)
  }
}

/**
 * 从 JSONP 里剥出 JSON 主体。
 * 新浪期货日 K 是 `/*<script>...</script>*\/\nvar t=([...]);` 这种形态。
 */
export function unwrapJsonp(text: string): string {
  const start = text.indexOf('([')
  const objStart = text.indexOf('({')
  const arr = start >= 0 ? start + 1 : -1
  const obj = objStart >= 0 ? objStart + 1 : -1
  let from = -1
  if (arr >= 0 && (obj < 0 || arr < obj)) from = arr
  else if (obj >= 0) from = obj
  if (from < 0) return text.trim()
  const closer = text[from] === '[' ? ']' : '}'
  const end = text.lastIndexOf(closer)
  return end > from ? text.slice(from, end + 1) : text.slice(from)
}

/** 安全取字段：空串 / '--' / undefined 一律返回 null，绝不返回 0（陷阱 6） */
export function numField(parts: readonly string[], i: number): number | null {
  const raw = parts[i]
  if (raw === undefined) return null
  const s = raw.trim()
  if (s === '' || s === '--' || s === 'null') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

export function strField(parts: readonly string[], i: number): string {
  return (parts[i] ?? '').trim()
}

/** 当前 ms 时间戳，统一出口便于测试替换 */
export function nowMs(): number {
  return Date.now()
}
