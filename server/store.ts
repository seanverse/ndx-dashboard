/**
 * 存储层：Vercel Blob 为主，本地文件系统为开发回退。
 *
 * 为什么读用固定 URL 而不是 list()：list() 每次消耗 1 个 Blob Simple Op，
 * 按前端访问量折算会打满 10,000/月的免费额度；直读固定 URL 则 Simple Op 为 0。
 * addRandomSuffix:false + allowOverwrite:true 保证覆盖写后路径不变。
 *
 * 两类键：
 *   - 固定键（latest / metrics）：每天或每 15 分钟覆盖一次，只保留最新版
 *   - 日期分片（daily/YYYY-MM-DD）：写一次不再变，是唯一的跨日历史
 * 分片路径必须走 readAt / writeAt，因为键名在编译期不存在。
 *
 * 本地开发：没有任何 Blob 变量且不在 Vercel 上时自动落到 .data/ 目录，
 * 使 `npm run dev` 与手工触发端点无需任何云账号即可跑通全链路。
 * 反之配了一半、或部署在 Vercel 却没配全，一律视为配置错误（storeStatus().mode === 'invalid'），
 * 既不读也不写本地文件 —— 见 storeStatus 的注释。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Blob 上的公共前缀；本地回退时这一段映射为 .data/ */
const BLOB_ROOT = 'data'
const LOCAL_DIR = path.resolve(process.cwd(), '.data')

export const PATHS = {
  latest: 'latest.json',
  metrics: 'metrics.json',
} as const

export type StoreKey = keyof typeof PATHS

/** 日快照按 tradeDate 分片，一天一个对象 */
export function dailyPath(tradeDate: string): string {
  return `daily/${tradeDate}.json`
}

export interface WriteOptions {
  cacheControlMaxAge?: number
}

/**
 * Blob 库的公网基址，未配置时为空串。
 *
 * 这个变量不在 Vercel 的自动注入清单里（注入的是 STORE_ID / WEBHOOK_KEY / TOKEN），
 * 必须手工填。手工就有两类常见写错：结尾多一个斜杠，或把对象 URL 连路径一起粘进来
 * （https://host/data/latest.json）。两种都在这里归一化掉，避免因为一个斜杠变成 404。
 */
function blobBase(): string {
  return (process.env.BLOB_BASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/data(?:\/.*)?$/i, '')
    .replace(/\/+$/, '')
}

function blobUrl(rel: string): string {
  return `${blobBase()}/${BLOB_ROOT}/${rel}`
}

/** 探测某个对象在 Blob 上的真实可达性，用于区分「基址写错」与「还没灌数」 */
export interface BlobProbe {
  url: string
  /** HTTP 状态码；连不上时为 null */
  status: number | null
  /** status 为 null 时的原因 */
  error?: string
}

/**
 * 直接发一次 GET 换取状态码，不做任何降级。
 *
 * 空库时 readAt 只能返回 null，无法区分「域名写错」和「对象还没写入」——
 * 这两种情况在页面上完全一样，但处理方式相反。所以诊断端点要的是状态码本身。
 */
export async function probeBlobObject(rel: string): Promise<BlobProbe> {
  const url = blobUrl(rel)
  try {
    const res = await fetch(url, { cache: 'no-store' })
    return { url, status: res.status }
  } catch (e) {
    return { url, status: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export type StoreMode = 'blob' | 'local' | 'invalid'

export interface StoreStatus {
  mode: StoreMode
  /** mode 为 invalid 时说明缺了什么，调用方据此给出可执行的提示 */
  problems: string[]
}

/**
 * 三态而不是两态：
 *   blob    云端可用
 *   local   本地开发（没有配置任何 Blob 变量，且不在 Vercel 上）
 *   invalid 配了一半或部署在 Vercel 却没配 —— 此时既不读也不写本地文件
 *
 * 区分 invalid 的目的是把「配置错误」和「还没有数据」分开。两者在页面上
 * 都表现为未就绪，但只有前者需要人去改配置，混在一起会白查很久。
 */
export function storeStatus(): StoreStatus {
  const base = blobBase()
  const token = process.env.BLOB_READ_WRITE_TOKEN
  const storeId = process.env.BLOB_STORE_ID
  const onVercel = Boolean(process.env.VERCEL)
  const touched = Boolean(base || token || storeId)

  if (!touched && !onVercel) return { mode: 'local', problems: [] }

  const problems: string[] = []
  if (!base) {
    problems.push('缺少 BLOB_BASE_URL（Blob 库的公网域名，形如 https://<store-id>.public.blob.vercel-storage.com）')
  }
  if (!token && !storeId) {
    problems.push('缺少 Blob 凭证 BLOB_READ_WRITE_TOKEN 或 BLOB_STORE_ID（把 Blob 库连接到项目后由 Vercel 注入）')
  }
  return problems.length > 0
    ? { mode: 'invalid', problems }
    : { mode: 'blob', problems: [] }
}

export interface EnvReport {
  /** 公网基址本身不是秘密，直接回显便于核对拼写 */
  baseUrl: string | null
  /** 凭证只回显是否已设置，不回显值 */
  tokenSet: boolean
  storeIdSet: boolean
  /** 所有名字里带 BLOB 的变量名，便于发现前缀写错或漏填 */
  blobRelatedNames: string[]
}

/** 诊断用：报告存储相关环境变量的实际情况，不含任何凭证值 */
export function describeEnv(): EnvReport {
  return {
    baseUrl: blobBase() || null,
    tokenSet: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    storeIdSet: Boolean(process.env.BLOB_STORE_ID),
    blobRelatedNames: Object.keys(process.env)
      .filter((key) => key.includes('BLOB'))
      .sort(),
  }
}

function localPath(rel: string): string {
  return path.join(LOCAL_DIR, rel)
}

/** 读任意相对路径。不存在、未配置或解析失败一律返回 null，由调用方按「无此数据」处理。 */
export async function readAt<T = unknown>(rel: string): Promise<T | null> {
  const { mode } = storeStatus()

  // invalid 时刻意不落本地：Vercel 上没有历史文件，读它只会把配置问题藏起来
  if (mode === 'invalid') return null

  try {
    if (mode === 'blob') {
      const res = await fetch(blobUrl(rel), { cache: 'no-store' })
      if (!res.ok) return null
      return (await res.json()) as T
    }
    const raw = await readFile(localPath(rel), 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 写任意相对路径。覆盖写，路径固定。 */
export async function writeAt(rel: string, value: unknown, opts: WriteOptions = {}): Promise<void> {
  const { mode, problems } = storeStatus()
  if (mode === 'invalid') {
    throw new Error(`存储未正确配置，已拒绝写入：${problems.join('；')}`)
  }

  const body = JSON.stringify(value)

  if (mode === 'blob') {
    const { put } = await import('@vercel/blob')
    const token = process.env.BLOB_READ_WRITE_TOKEN
    const storeId = process.env.BLOB_STORE_ID
    await put(`${BLOB_ROOT}/${rel}`, body, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: opts.cacheControlMaxAge ?? 60,
      contentType: 'application/json',
      // 有静态 token 就用 token；只有 store id 时交给 OIDC（Vercel 每次请求注入）
      ...(token ? { token } : { storeId }),
    })
    return
  }

  const file = localPath(rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body, 'utf8')
}

/** 读固定键 */
export function readJson<T>(key: StoreKey): Promise<T | null> {
  return readAt<T>(PATHS[key])
}

/** 写固定键 */
export function writeJson(key: StoreKey, value: unknown, opts: WriteOptions = {}): Promise<void> {
  return writeAt(PATHS[key], value, opts)
}

export const storeMode = (): StoreMode => storeStatus().mode

/** 配置错误时抛出可读信息，让脚本与调试端点一眼看到缺什么 */
export function assertStoreReady(): void {
  const { mode, problems } = storeStatus()
  if (mode === 'invalid') throw new Error(`存储未正确配置：${problems.join('；')}`)
}
