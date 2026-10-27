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
 * 读环境变量：先认标准名，再按「唯一后缀」兜住带前缀的情况。
 *
 * 在 Vercel 建 Blob 库时 Advanced Options 可以给变量加前缀（例如 NDX_BLOB_READ_WRITE_TOKEN），
 * 而 @vercel/blob 的默认查找只认不带前缀的名字。加了前缀，SDK 就找不到凭证，
 * 这类失败不会报错，只会表现为「没有数据」。
 *
 * 多个前缀同时命中时直接抛错，不猜：猜错 store 会把数据写进另一个库。
 */
interface EnvHit {
  /** 实际命中的变量名，标准名或带前缀的版本 */
  key: string | null
  value: string | null
  /** 多个前缀同时命中的变量名；非空时表示无法确定用哪个 */
  ambiguous: string[]
}

/**
 * 解析环境变量：标准名优先，其次按「唯一后缀」匹配带前缀的版本。
 *
 * 歧义不抛错，而是作为结果返回：抛错会让整个请求 500，而歧义本质是配置问题，
 * 应该以「缺什么/冲突什么」的形式出现在诊断信息里，让人看到而不是让进程崩掉。
 */
function resolveEnv(name: string): EnvHit {
  const exact = process.env[name]
  if (exact) return { key: name, value: exact, ambiguous: [] }

  const matches = Object.keys(process.env).filter(
    (key) => key.endsWith(`_${name}`) && Boolean(process.env[key]),
  )
  if (matches.length > 1) return { key: null, value: null, ambiguous: matches }

  const [only] = matches
  if (only === undefined) return { key: null, value: null, ambiguous: [] }
  return { key: only, value: process.env[only] ?? null, ambiguous: [] }
}

function readEnv(name: string): string | undefined {
  return resolveEnv(name).value ?? undefined
}

/** Blob 库的公网基址，末尾斜杠去掉；未配置时为空串 */
function blobBase(): string {
  return (process.env.BLOB_BASE_URL ?? '').trim().replace(/\/+$/, '')
}

function blobUrl(rel: string): string {
  return `${blobBase()}/${BLOB_ROOT}/${rel}`
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
  const tokenHit = resolveEnv('BLOB_READ_WRITE_TOKEN')
  const storeHit = resolveEnv('BLOB_STORE_ID')
  const base = blobBase()
  const onVercel = Boolean(process.env.VERCEL)
  const touched = Boolean(base || tokenHit.value || storeHit.value || tokenHit.ambiguous.length || storeHit.ambiguous.length)

  const ambiguity = [
    ...tokenHit.ambiguous.map((name) => `BLOB_READ_WRITE_TOKEN 有多个前缀版本：${name}`),
    ...storeHit.ambiguous.map((name) => `BLOB_STORE_ID 有多个前缀版本：${name}`),
  ]
  if (ambiguity.length > 0) {
    return { mode: 'invalid', problems: ambiguity.map((p) => `${p}，无法确定使用哪一个`) }
  }

  if (!touched && !onVercel) return { mode: 'local', problems: [] }

  const problems: string[] = []
  if (!base) {
    problems.push('缺少 BLOB_BASE_URL（Blob 库的公网域名，形如 https://<store-id>.public.blob.vercel-storage.com）')
  }
  if (!tokenHit.value && !storeHit.value) {
    problems.push('缺少 Blob 凭证 BLOB_READ_WRITE_TOKEN 或 BLOB_STORE_ID（把 Blob 库连接到项目后由 Vercel 注入）')
  }
  return problems.length > 0
    ? { mode: 'invalid', problems }
    : { mode: 'blob', problems: [] }
}

export interface EnvReport {
  /** 公网基址本身不是秘密，直接回显便于核对拼写 */
  baseUrl: string | null
  /** 只回显命中的变量名与歧义情况，不回显任何凭证的值 */
  tokenVar: string | null
  tokenAmbiguous: string[]
  storeIdVar: string | null
  storeIdAmbiguous: string[]
  /** 所有名字里带 BLOB 的变量名，便于发现前缀写错或漏填 */
  blobRelatedNames: string[]
}

/** 诊断用：报告存储相关环境变量的实际情况，不含任何凭证值 */
export function describeEnv(): EnvReport {
  const tokenHit = resolveEnv('BLOB_READ_WRITE_TOKEN')
  const storeHit = resolveEnv('BLOB_STORE_ID')
  return {
    baseUrl: blobBase() || null,
    tokenVar: tokenHit.key,
    tokenAmbiguous: tokenHit.ambiguous,
    storeIdVar: storeHit.key,
    storeIdAmbiguous: storeHit.ambiguous,
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
    const token = readEnv('BLOB_READ_WRITE_TOKEN')
    const storeId = readEnv('BLOB_STORE_ID')
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
