/**
 * 存储配置解析。
 *
 * 锁住三件事：
 *   1. Vercel 建库时给变量加了前缀，代码仍然认（否则线上静默落本地只读盘）
 *   2. 标准名优先于带前缀的版本，多个前缀同时存在则报错而不是乱挑
 *   3. 「配了一半」与「本地开发没配」必须区分开
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeEnv, storeStatus } from '../server/store'

const KEYS = [
  'BLOB_BASE_URL',
  'BLOB_READ_WRITE_TOKEN',
  'BLOB_STORE_ID',
  'BLOB_WEBHOOK_PUBLIC_KEY',
  'VERCEL',
  'NDX_BLOB_READ_WRITE_TOKEN',
  'NDX_BLOB_STORE_ID',
  'NDX_BLOB_WEBHOOK_PUBLIC_KEY',
  'OLD_BLOB_READ_WRITE_TOKEN',
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

  it('带前缀的 token 与 store id 能被识别', () => {
    process.env.BLOB_BASE_URL = BASE
    process.env.NDX_BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_ndx'
    process.env.NDX_BLOB_STORE_ID = 'store_ndx'
    expect(storeStatus()).toEqual({ mode: 'blob', problems: [] })
  })

  it('只有带前缀的 store id 也足够（走 OIDC）', () => {
    process.env.BLOB_BASE_URL = BASE
    process.env.NDX_BLOB_STORE_ID = 'store_ndx'
    expect(storeStatus().mode).toBe('blob')
  })

  it('前缀版不完整时报告缺哪一项，而不是直接落本地', () => {
    process.env.VERCEL = '1'
    process.env.NDX_BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_ndx'
    process.env.NDX_BLOB_STORE_ID = 'store_ndx'
    const status = storeStatus()
    expect(status.mode).toBe('invalid')
    expect(status.problems).toHaveLength(1)
    expect(status.problems[0]).toContain('BLOB_BASE_URL')
  })

  it('标准名与带前缀同时存在时以标准名为准', () => {
    process.env.BLOB_BASE_URL = BASE
    process.env.BLOB_READ_WRITE_TOKEN = 'standard'
    process.env.NDX_BLOB_READ_WRITE_TOKEN = 'prefixed'
    // 只验证不会被前缀版干扰：仍然判定为可用
    expect(storeStatus().mode).toBe('blob')
  })

  it('多个前缀同时命中时判定为配置错误，而不是抛错崩掉请求', () => {
    process.env.BLOB_BASE_URL = BASE
    process.env.NDX_BLOB_READ_WRITE_TOKEN = 'a'
    process.env.OLD_BLOB_READ_WRITE_TOKEN = 'b'
    const status = storeStatus()
    expect(status.mode).toBe('invalid')
    expect(status.problems.join()).toContain('多个前缀版本')
    expect(status.problems.join()).toContain('NDX_BLOB_READ_WRITE_TOKEN')
    delete process.env.OLD_BLOB_READ_WRITE_TOKEN
  })
})

describe('describeEnv', () => {
  it('只回显变量名与基址，不回显凭证值', () => {
    process.env.BLOB_BASE_URL = BASE
    process.env.NDX_BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_should_not_leak'
    const report = describeEnv()

    expect(report.tokenVar).toBe('NDX_BLOB_READ_WRITE_TOKEN')
    expect(report.baseUrl).toBe(BASE)
    expect(JSON.stringify(report)).not.toContain('should_not_leak')
    expect(report.blobRelatedNames).toContain('NDX_BLOB_READ_WRITE_TOKEN')
  })
})
