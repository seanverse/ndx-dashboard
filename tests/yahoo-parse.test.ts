/**
 * Yahoo chart API 解析。
 *
 * fixture 取自 2026-10-27 真实响应（^NDX）。锁住四点：
 *   1. 正常 payload 各字段取对位置
 *   2. previousClose 缺失时回落 chartPreviousClose（后者随 range 变化，只做备胎）
 *   3. 价 / 昨收任一缺失 → null（走备源），绝不拿 null 顶 0
 *   4. 结构损坏（error 数组 / result 空）→ null 而不是抛
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseYahooChart } from '../server/adapters/yahoo'

const FIXTURE = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'yahoo-ndx.json'),
    'utf8',
  ),
)

describe('parseYahooChart', () => {
  it('真实响应：各字段取对位置', () => {
    const q = parseYahooChart(FIXTURE)
    expect(q).not.toBeNull()
    expect(q?.symbol).toBe('^NDX')
    expect(q?.value).toBe(29273.404)
    expect(q?.prevClose).toBe(28957.527)
    expect(q?.high).toBe(29404.438)
    expect(q?.low).toBe(29011.914)
    expect(q?.volume).toBe(1_209_440_000)
    expect(q?.time).toBe(1_793_049_359)
  })

  it('previousClose 缺失时回落 chartPreviousClose', () => {
    const json = {
      chart: {
        result: [
          {
            meta: {
              symbol: 'CL=F',
              regularMarketPrice: 101.04,
              chartPreviousClose: 101.76,
            },
          },
        ],
      },
    }
    expect(parseYahooChart(json)?.prevClose).toBe(101.76)
  })

  it('价或昨收缺失返回 null，由调用方切备源', () => {
    expect(parseYahooChart({ chart: { result: [{ meta: { symbol: '^NDX' } }] } })).toBeNull()
    expect(
      parseYahooChart({ chart: { result: [{ meta: { regularMarketPrice: 1 } }] } }),
    ).toBeNull()
    expect(
      parseYahooChart({ chart: { result: [{ meta: { chartPreviousClose: 1 } }] } }),
    ).toBeNull()
  })

  it('meta 没有 open 时从分钟 K 数组取首个非空值（今开）', () => {
    const json = {
      chart: {
        result: [
          {
            meta: { symbol: '^NDX', regularMarketPrice: 29392, previousClose: 29273 },
            timestamp: [1, 2, 3],
            indicators: { quote: [{ open: [null, 29407.38, 29492.08] }] },
          },
        ],
      },
    }
    expect(parseYahooChart(json)?.open).toBe(29407.38)
  })

  it('数组全空或缺失时 open 为 null，不编造', () => {
    const noArrays = {
      chart: {
        result: [{ meta: { symbol: '^NDX', regularMarketPrice: 29392, previousClose: 29273 } }],
      },
    }
    expect(parseYahooChart(noArrays)?.open).toBeNull()
    const allNull = {
      chart: {
        result: [
          {
            meta: { symbol: '^NDX', regularMarketPrice: 29392, previousClose: 29273 },
            indicators: { quote: [{ open: [null, null] }] },
          },
        ],
      },
    }
    expect(parseYahooChart(allNull)?.open).toBeNull()
  })

  it('结构损坏（限流 429 的 error 形态、result 为空）返回 null', () => {
    expect(parseYahooChart({ chart: { result: null, error: { code: 'Too Many Requests' } } })).toBeNull()
    expect(parseYahooChart({ chart: { result: [] } })).toBeNull()
    expect(parseYahooChart(null)).toBeNull()
  })

  it('非有限数（NaN / 字符串数字）不当有效值', () => {
    const json = {
      chart: {
        result: [
          { meta: { symbol: 'GC=F', regularMarketPrice: '4036.5', chartPreviousClose: 4038.4 } },
        ],
      },
    }
    expect(parseYahooChart(json)).toBeNull()
  })
})
