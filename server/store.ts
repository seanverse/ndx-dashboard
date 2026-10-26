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
 * 本地开发：没有 BLOB_READ_WRITE_TOKEN 时自动落到 .data/ 目录，
 * 使 `npm run dev` 与手工触发端点无需任何云账号即可跑通全链路。
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

function hasBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.BLOB_BASE_URL)
}

function blobUrl(rel: string): string {
  const base = (process.env.BLOB_BASE_URL ?? '').replace(/\/$/, '')
  return `${base}/${BLOB_ROOT}/${rel}`
}

function localPath(rel: string): string {
  return path.join(LOCAL_DIR, rel)
}

/** 读任意相对路径。不存在或解析失败一律返回 null，由调用方按「无此数据」处理。 */
export async function readAt<T = unknown>(rel: string): Promise<T | null> {
  try {
    if (hasBlob()) {
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
  const body = JSON.stringify(value)

  if (hasBlob()) {
    const { put } = await import('@vercel/blob')
    await put(`${BLOB_ROOT}/${rel}`, body, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: opts.cacheControlMaxAge ?? 60,
      contentType: 'application/json',
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

export const storeMode = (): 'blob' | 'local' => (hasBlob() ? 'blob' : 'local')
