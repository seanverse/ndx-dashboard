/**
 * 交易日历与时段判定。
 *
 * 重点覆盖两个曾经出错的点：
 * 1) 00:00–04:00 ET 属于休市，不是「盘前」（否则周日夜里会被标成盘前）；
 * 2) 收盘时刻换算必须跟着 DST 走，否则「距收盘多久」会差一小时。
 */

import { describe, expect, it } from 'vitest'
import { closeMomentUtc, etParts, isTradingWindow, tradingPhase } from '../server/calendar'

describe('tradingPhase', () => {
  it('美东周一 01:25（周日深夜）应判休市，不是盘前', () => {
    // 2026-10-26 05:25Z = 01:25 EDT
    expect(tradingPhase(new Date('2026-10-26T05:25:00Z'))).toBe('closed')
  })

  it('美东 04:00 起进入盘前', () => {
    expect(tradingPhase(new Date('2026-10-26T08:00:00Z'))).toBe('pre') // 04:00 EDT
    expect(tradingPhase(new Date('2026-10-26T12:00:00Z'))).toBe('pre') // 08:00 EDT
  })

  it('09:30–16:00 为盘中', () => {
    expect(tradingPhase(new Date('2026-10-26T13:30:00Z'))).toBe('open') // 09:30 EDT
    expect(tradingPhase(new Date('2026-10-26T19:59:00Z'))).toBe('open') // 15:59 EDT
  })

  it('16:00–20:00 为盘后，之后休市', () => {
    expect(tradingPhase(new Date('2026-10-26T20:00:00Z'))).toBe('post') // 16:00 EDT
    expect(tradingPhase(new Date('2026-10-26T23:30:00Z'))).toBe('post') // 19:30 EDT
expect(tradingPhase(new Date('2026-10-27T00:30:00Z'))).toBe('closed') // 20:30 EDT
  })

  it('周末一律休市', () => {
    expect(tradingPhase(new Date('2026-10-24T15:00:00Z'))).toBe('closed') // 周六
    expect(tradingPhase(new Date('2026-10-25T15:00:00Z'))).toBe('closed') // 周日
  })
})

describe('closeMomentUtc', () => {
  it('夏令时收盘 16:00 EDT = 20:00 UTC', () => {
    expect(closeMomentUtc('2026-10-23').toISOString()).toBe('2026-10-23T20:00:00.000Z')
    expect(etParts(closeMomentUtc('2026-10-23')).hour).toBe(16)
  })

  it('冬令时收盘 16:00 EST = 21:00 UTC', () => {
    expect(closeMomentUtc('2026-01-15').toISOString()).toBe('2026-01-15T21:00:00.000Z')
    expect(etParts(closeMomentUtc('2026-01-15')).hour).toBe(16)
  })

  it('半日市收在 13:00 ET', () => {
    expect(etParts(closeMomentUtc('2026-11-27')).hour).toBe(13)
    expect(etParts(closeMomentUtc('2026-12-24')).hour).toBe(13)
  })
})

describe('isTradingWindow', () => {
  it('盘中窗口内为真，开盘前为假', () => {
    expect(isTradingWindow(new Date('2026-10-26T14:00:00Z'))).toBe(true) // 10:00 EDT
    expect(isTradingWindow(new Date('2026-10-26T13:00:00Z'))).toBe(false) // 09:00 EDT
  })

  it('末尾留 20 分钟抓收盘价：16:10 仍算窗口内', () => {
    expect(isTradingWindow(new Date('2026-10-26T20:10:00Z'))).toBe(true) // 16:10 EDT
    expect(isTradingWindow(new Date('2026-10-26T20:30:00Z'))).toBe(false) // 16:30 EDT
  })
})
