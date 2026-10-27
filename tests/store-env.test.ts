/**
 * 存储配置解析。
 *
 * 锁住两件事：
 *   1. 「配了一半」与「本地开发没配」必须区分开
 *   2. 手工填的 BLOB_BASE_URL 常见写法（尾斜杠 / 误粘对象 URL）要归一化，
 *      而不是变成「没有数据」这种没有指向性的现象
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeEnv, storeStatus } from '../server/store'

const KEYS = [
  'BLOB_BASE_URL',
  'BLOB_READ_WRITE_TOKEN',
  'BLOB_STORE_ID',
  'BLOB_WEBHOOK_PUBLIC_KEY',
  'VERCEL',
] as const

const BASE = 'https://demo1234.public.blob.vercel-storage.com'

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('storeStatus', () => {
  it('本地开发没有任何 Blob 变量时落到本地模式，且不算错误', () => {
    const status = storeStatus()
    expect(status.mode).toBe('local')
    expect(status.problems).toEqual([])
  })

  it('Vercel 上什么都没配时视为配置错误，而不是回落本地', () => {
    process.env.VERCEL = '1'
    const status = storeStatus()
    expect(status.mode).toBe('invalid')
    expect(status.problems.join()).toContain('BLOB_BASE_URL')
    expect(status.problems.join()).toContain('BLOB_READ_WRITE_TOKEN')
  })

  it('只有 token 没有 base 时报告缺哪一项，而不是直接落本地', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_demo'
    const status = storeStatus()
    expect(status.mode).toBe('invalid')
    expect(status.problems).toHaveLength(1)
    expect(status.problems[0]).toContain('BLOB_BASE_URL')
  })

  it('base + token 为完整配置', () => {
    process.env.BLOB_BASE_URL = BASE
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_demo'
    expect(storeStatus()).toEqual({ mode: 'blob', problems: [] })
  })

  it('只有 store id 也足够（走 OIDC）', () => {
    process.env.BLOB_BASE_URL = BASE
    process.env.BLOB_STORE_ID = 'store_demo'
    expect(storeStatus().mode).toBe('blob')
  })
})

describe('describeEnv', () => {
  it('只回显是否设置与基址，不回显凭证值', () => {
    process.env.BLOB_BASE_URL = BASE
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_should_not_leak'
    const report = describeEnv()

    expect(report.tokenSet).toBe(true)
    expect(report.baseUrl).toBe(BASE)
    expect(JSON.stringify(report)).not.toContain('should_not_leak')
    expect(report.blobRelatedNames).toContain('BLOB_READ_WRITE_TOKEN')
  })

  it('基址结尾带斜杠时归一化', () => {
    process.env.BLOB_BASE_URL = `${BASE}//`
    expect(describeEnv().baseUrl).toBe(BASE)
  })

  it('误把对象 URL 粘成基址时剥掉 /data 之后的部分', () => {
    process.env.BLOB_BASE_URL = `${BASE}/data/latest.json`
    expect(describeEnv().baseUrl).toBe(BASE)
  })

  it('剥离后不影响判定：仍然算配置完整', () => {
    process.env.BLOB_BASE_URL = `${BASE}/data/`
    process.env.BLOB_STORE_ID = 'store_demo'
    expect(storeStatus().mode).toBe('blob')
  })
})
