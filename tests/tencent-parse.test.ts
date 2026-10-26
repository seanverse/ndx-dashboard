/**
 * 腾讯接口两套格式的解析。
 *
 * 回归点：早期统一按美股格式（`200~` 前缀 + `~` 分隔）解析，导致 hf_CL/hf_GC
 * 恒为 null —— 原油/黄金的备源看起来配了，其实从没生效过。
 */

import { describe, expect, it } from 'vitest'
import { parseBlocks } from '../server/adapters/tencent'

const SAMPLE = [
  'v_usNDX="200~纳斯达克100~.NDX~28957.53~28958.69~28847.82~1043947617~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~~2026-10-23 17:15:59~-1.16~0.00~29161.03~28825.72~USD";',
  'v_hf_CL="101.10,-2.10,101.13,101.14,102.63,100.69,13:24:00,103.27,102.61,0,2,3,2026-10-26,纽约原油";',
  'v_pnone_match="";',
].join('\n')

describe('parseBlocks', () => {
  it('美股：按 ~ 分隔，首段是 200 状态位', () => {
    const m = parseBlocks(SAMPLE, ['usNDX'])
    const p = m.get('usNDX')
    expect(p).toBeDefined()
    expect(p?.[0]).toBe('200')
    expect(p?.[3]).toBe('28957.53')
    expect(p?.[4]).toBe('28958.69')
  })

  it('期货：按逗号分隔，无状态位前缀', () => {
    const m = parseBlocks(SAMPLE, ['hf_CL'])
    const p = m.get('hf_CL')
    expect(p).toBeDefined()
    expect(p?.[0]).toBe('101.10')
    expect(p?.[7]).toBe('103.27')
    expect(p?.length).toBe(14)
  })

  it('空返回体与无关键丢弃，不污染结果', () => {
    const m = parseBlocks(SAMPLE, ['pnone_match', 'hf_GC'])
    expect(m.has('pnone_match')).toBe(false)
    expect(m.has('hf_GC')).toBe(false)
    expect(m.size).toBe(0)
  })

  it('只返回请求的代码', () => {
    const m = parseBlocks(SAMPLE, ['hf_CL'])
    expect([...m.keys()]).toEqual(['hf_CL'])
  })
})
