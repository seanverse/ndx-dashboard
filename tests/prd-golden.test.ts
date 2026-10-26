/**
 * 验收 A1–A5：用 PRD-001 §4.1 的参考图数据做 golden test。
 * 这些断言是「指标计算是否正确」的唯一判据，改动 compute 层前必须先跑通本文件。
 */

import { describe, expect, it } from 'vitest'
import {
  ADVICE_RULES,
  FGI_BANDS,
  PE_BANDS,
  RISK_BANDS,
  RISK_LEVELS,
  RSI_BANDS,
  VXN_BANDS,
  buildAdvice,
  buildQuote,
  buildRsi,
  buildValuation,
  buildVxn,
  computeScore,
  hv,
  macroPattern,
  macroRaw,
  momentumScore,
  mps,
  pickBand,
  rollingCorr,
  rsi,
  starsFromHealth,
  volatilityScore,
  zScoreLast,
} from '../shared/compute'
import type { RiskLevel } from '../shared/types'

/** PRD-001 §4.1 输入数据，逐字照抄 */
const REF = {
  close: 29529.34,
  prevClose: 29187.55,
  open: 29539.31,
  high: 29788.76,
  low: 29461.32,
  volume: 1_191_000_000,
  change: 341.79,
  changePct: 1.17,
  amplitude: 1.12,
  fgi: 23,
  vxn: 25.56,
  vxnChange: 2.67,
  vxnChangePct: 11.66,
  peTTM: 29.73,
  pePercentile: 43.5,
  rsi6: 25.74,
  rsi12: 27.45,
  rsi24: 34.33,
  stars: 2.5,
  riskLevel: '偏高' as RiskLevel,
} as const

describe('A1 公式可复现（PRD §4.2，误差 0）', () => {
  const q = buildQuote({
    close: REF.close,
    prevClose: REF.prevClose,
    open: REF.open,
    high: REF.high,
    low: REF.low,
    volume: REF.volume,
  })

  it('① 涨跌额 = close − prevClose = 341.79', () => {
    expect(q.change).toBeCloseTo(REF.change, 2)
  })

  it('② 涨跌幅 = 341.79 / 29187.55 = 1.1710%', () => {
    expect(q.changePct).toBeCloseTo(1.171, 3)
    expect(q.changePct.toFixed(2)).toBe('1.17')
  })

  it('③ 振幅分母为昨收 = 1.1218%（用今开会得 1.1085%，与图不符）', () => {
    expect(q.amplitude).toBeCloseTo(1.1218, 3)
    const wrongBasis = ((REF.high - REF.low) / REF.open) * 100
    expect(wrongBasis).toBeCloseTo(1.1085, 3)
    // 两者四舍五入后分别是 1.12 与 1.11，图值支持昨收口径
    expect(q.amplitude?.toFixed(2)).toBe('1.12')
    expect(wrongBasis.toFixed(2)).toBe('1.11')
  })

  it('④ VXN 涨跌幅 = 2.67 / (25.56 − 2.67) = 11.6645%', () => {
    const v = buildVxn({
      value: REF.vxn,
      prevClose: REF.vxn - REF.vxnChange,
      ma20: null,
    })
    expect(v.change).toBeCloseTo(REF.vxnChange, 2)
    expect(v.changePct).toBeCloseTo(11.6645, 3)
    expect(v.changePct.toFixed(2)).toBe('11.66')
  })

  it('⑤ RSI 均值 = (25.740 + 27.450 + 34.330) / 3 = 29.1733', () => {
    const r = buildRsi({ rsi6: REF.rsi6, rsi12: REF.rsi12, rsi24: REF.rsi24 })
    expect(r).not.toBeNull()
    expect(r!.mean).toBeCloseTo(29.1733, 3)
  })

  it('⑥ RSI 单调性 D = rsi6 − rsi24 = −8.59 → 下行加速', () => {
    const r = buildRsi({ rsi6: REF.rsi6, rsi12: REF.rsi12, rsi24: REF.rsi24 })
    expect(r!.rsi6 - r!.rsi24).toBeCloseTo(-8.59, 2)
    expect(r!.slope).toBe('down')
  })
})

describe('A2 分档无歧义（边界值归属唯一）', () => {
  const fgi = (x: number) => pickBand(FGI_BANDS, x)?.key
  it('恐贪：24.99 极度恐惧 / 25 恐惧 / 44.99 恐惧 / 45 中性 / 55.99 中性 / 56 贪婪 / 76 极度贪婪', () => {
    expect(fgi(24.99)).toBe('extreme_fear')
    expect(fgi(25)).toBe('fear')
    expect(fgi(44.99)).toBe('fear')
    expect(fgi(45)).toBe('neutral')
    expect(fgi(55.99)).toBe('neutral')
    expect(fgi(56)).toBe('greed')
    expect(fgi(75.99)).toBe('greed')
    expect(fgi(76)).toBe('extreme_greed')
  })

  const vxn = (x: number) => pickBand(VXN_BANDS, x)?.key
  it('VXN：14.99 极低 / 15 低 / 20 正常 / 25 偏高 / 35 高 / 50 极高', () => {
    expect(vxn(14.99)).toBe('very_low')
    expect(vxn(15)).toBe('low')
    expect(vxn(20)).toBe('normal')
    expect(vxn(25)).toBe('elevated')
    expect(vxn(35)).toBe('high')
    expect(vxn(50)).toBe('extreme')
  })

  it('VXN 25.56 落「偏高」，与参考图正文一致（修 D3）', () => {
    expect(pickBand(VXN_BANDS, REF.vxn)?.label).toBe('偏高')
  })

  const pe = (x: number) => pickBand(PE_BANDS, x)?.key
  it('PE 百分位：25 合理 / 75 偏贵 / 90 高估 / 100 高估', () => {
    expect(pe(24.99)).toBe('cheap')
    expect(pe(25)).toBe('fair')
    expect(pe(74.99)).toBe('fair')
    expect(pe(75)).toBe('expensive')
    expect(pe(90)).toBe('very_expensive')
    expect(pe(100)).toBe('very_expensive')
  })

  it('PE 43.5% 判「合理」，与参考图一致', () => {
    expect(buildValuation({ peTTM: REF.peTTM, percentile: REF.pePercentile }).state).toBe('fair')
  })

  const rsiBand = (x: number) => pickBand(RSI_BANDS, x)?.key
  it('RSI：29.99 超卖 / 30 偏弱 / 45 中性 / 55 偏强 / 70 超买', () => {
    expect(rsiBand(29.99)).toBe('oversold')
    expect(rsiBand(30)).toBe('weak')
    expect(rsiBand(45)).toBe('neutral')
    expect(rsiBand(55)).toBe('strong')
    expect(rsiBand(70)).toBe('overbought')
  })

  it('RSI6 25.74 / RSI12 27.45 判「超卖」，非参考图的「偏弱」（修 D2）', () => {
    const r = buildRsi({ rsi6: REF.rsi6, rsi12: REF.rsi12, rsi24: REF.rsi24 })
    expect(rsiBand(r!.rsi6)).toBe('oversold')
    expect(rsiBand(r!.rsi12)).toBe('oversold')
    expect(rsiBand(r!.rsi24)).toBe('weak')
    // 三期跨两档 → 输出均值档，并标分歧
    expect(r!.consistency).toBe(false)
    expect(r!.combined).toBe('oversold')
  })

  const risk = (h: number) => pickBand(RISK_BANDS, h)?.key
  it('风险等级：20 高 / 35 偏高 / 50 中性 / 65 偏低 / 80 低 / 100 低', () => {
    expect(risk(19.99)).toBe('极高')
    expect(risk(20)).toBe('高')
    expect(risk(35)).toBe('偏高')
    expect(risk(50)).toBe('中性')
    expect(risk(65)).toBe('偏低')
    expect(risk(80)).toBe('低')
    expect(risk(100)).toBe('低')
  })

  it('缺数不落入任何档（返回 null）', () => {
    expect(pickBand(FGI_BANDS, null)).toBeNull()
    expect(pickBand(FGI_BANDS, Number.NaN)).toBeNull()
  })
})

describe('A3/A4 综合评分与建议（PRD §4.5）', () => {
  const score = computeScore({
    fgi: REF.fgi,
    vxn: REF.vxn,
    pePercentile: REF.pePercentile,
    rsiMean: (REF.rsi6 + REF.rsi12 + REF.rsi24) / 3,
    macroHealth: null,
  })

  it('四维分值与 PRD 手算一致：23.0 / 53.3 / 56.5 / 25.0', () => {
    expect(score).not.toBeNull()
    expect(score!.dims.sentiment).toBeCloseTo(23.0, 1)
    expect(score!.dims.volatility).toBeCloseTo(53.3, 1)
    expect(score!.dims.valuation).toBeCloseTo(56.5, 1)
    expect(score!.dims.momentum).toBeCloseTo(25.0, 1)
  })

  it('H = 39.45，星级 2.0（参考图 2.5 不可复现，差一个步长）', () => {
    expect(score!.health).toBeCloseTo(39.45, 1)
    expect(score!.stars).toBe(2.0)
    expect(score!.stars).not.toBe(REF.stars)
  })

  it('风险等级「偏高」与仓位 65–75% 与参考图完全一致', () => {
    expect(score!.riskLevel).toBe(REF.riskLevel)
    const advice = buildAdvice(score!.riskLevel, 'down')
    expect(advice.position).toEqual([65, 75])
    expect(advice.ruleId).toBe('R3')
  })

  it('星级 0.5 粒度：H=39.45 → 2.0；H=45 → 2.5；H=50 → 2.5；H=60 → 3.0', () => {
    expect(starsFromHealth(39.45)).toBe(2.0)
    expect(starsFromHealth(45)).toBe(2.5)
    expect(starsFromHealth(50)).toBe(2.5)
    expect(starsFromHealth(60)).toBe(3.0)
    expect(starsFromHealth(100)).toBe(5.0)
    expect(starsFromHealth(0)).toBe(0)
  })

  it('建议唯一确定：五个等级各映射一个 ruleId', () => {
    const map = (['低', '偏低', '中性', '偏高', '高', '极高'] as RiskLevel[]).map(
      (lv) => buildAdvice(lv, null).ruleId,
    )
    expect(map).toEqual(['R1', 'R1', 'R2', 'R3', 'R4', 'R5'])
    expect(buildAdvice('低', null).position).toEqual([90, 100])
    expect(buildAdvice('极高', null).position).toEqual([20, 45])
  })

  it('界面五档规则表与规则引擎同源：5 条覆盖 6 档，文案逐字一致', () => {
    expect(ADVICE_RULES.map((r) => r.ruleId)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5'])

    // 覆盖完整：6 个档位一个不漏、不重复
    const covered = ADVICE_RULES.flatMap((r) => [...r.levels])
    expect([...covered].sort()).toEqual([...RISK_LEVELS].sort())

    for (const row of ADVICE_RULES) {
      // 规则短语是命中标识的文案，不能为空，也不能盖到别的规则上
      expect(row.phrase.length).toBeGreaterThan(0)
      for (const level of row.levels) {
        const a = buildAdvice(level, null)
        expect(a.ruleId).toBe(row.ruleId)
        expect(row.longTerm).toBe(a.longTerm.join('；'))
        expect(row.newMoney).toBe(a.newMoney.join('；'))
        // 仓位文案随 POSITION_BY_RISK 联动，不是另写的字符串
        expect(row.positionText).toContain(`${a.position[0]}–${a.position[1]}%`)
      }
    }
  })
})

describe('A5 缺数不污染（权重重分配，不按 0 计）', () => {
  it('FGI 缺失时其余三维等权平均，health 不含 0 项', () => {
    const s = computeScore({
      fgi: null,
      vxn: 20,
      pePercentile: 50,
      rsiMean: 50,
      macroHealth: null,
    })
    expect(s).not.toBeNull()
    // (75 + 50 + 60) / 3 = 61.667，若按 0 计则为 46.25
    expect(s!.health).toBeCloseTo(61.67, 1)
    expect(s!.dims.sentiment).toBeNull()
  })

  it('全部缺失时返回 null，不产出 0 分', () => {
    const s = computeScore({
      fgi: null,
      vxn: null,
      pePercentile: null,
      rsiMean: null,
      macroHealth: null,
    })
    expect(s).toBeNull()
  })

  it('实际参与权重归一化后总和为 1', () => {
    const s = computeScore({
      fgi: 23,
      vxn: null,
      pePercentile: 43.5,
      rsiMean: 29.17,
      macroHealth: null,
    })
    const total = Object.values(s!.weights).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 6)
  })
})

describe('M5 RSI 计算（Wilder 平滑）', () => {
  it('全涨序列 RSI = 100；全跌序列 RSI = 0', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i)
    const down = Array.from({ length: 40 }, (_, i) => 200 - i)
    expect(rsi(up, 6)).toBe(100)
    expect(rsi(down, 6)).toBe(0)
  })

  it('等幅震荡 RSI = 50（种子为前 N 期简单均值）', () => {
    expect(rsi([10, 11, 10, 11, 10, 11, 10], 6)).toBeCloseTo(50, 6)
  })

  it('Wilder 递推手算校验：序列 [10,11,12,11,12,13,12,13] N=6 → 72.2222', () => {
    // 前 6 个变化 +1,+1,-1,+1,+1,-1 → avgGain=4/6, avgLoss=2/6
    // 第 7 个变化 +1 → avgGain=(1/6)+(5/6)(4/6)=0.72222, avgLoss=(5/6)(2/6)=0.27778
    // RS=2.6 → RSI=72.2222
    expect(rsi([10, 11, 12, 11, 12, 13, 12, 13], 6)).toBeCloseTo(72.2222, 3)
  })

  it('序列不足 N+1 返回 null，不返回 0', () => {
    expect(rsi([1, 2, 3], 6)).toBeNull()
    expect(rsi([1, 2, 3, 4, 5, 6], 6)).toBeNull() // N+1=7 个点才够，6 个不足
    expect(rsi([1, 2, 3, 4, 5, 6, 7], 6)).not.toBeNull()
  })
})

describe('HV20 / z-score / 相关性', () => {
  it('HV20 对恒定收益率序列等于 0', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 * 1.01 ** i)
    expect(hv(closes, 20)).toBeCloseTo(0, 8)
  })

  it('HV20 年化口径：日波动 1% ≈ 15.87%', () => {
    // 构造交替 ±1% 的序列，对数收益标准差接近 1%
    const closes = [100]
    for (let i = 0; i < 30; i++) closes.push((closes[closes.length - 1] as number) * (i % 2 ? 1.01 : 0.99))
    const v = hv(closes, 20) as number
    expect(v).toBeGreaterThan(14)
    expect(v).toBeLessThan(17)
  })

  it('z-score 对线性递增序列为正，末值高于均值', () => {
    const s = Array.from({ length: 60 }, (_, i) => 100 + i)
    expect(zScoreLast(s, 60)).toBeGreaterThan(1)
  })

  it('z-score 对常数序列返回 null（σ=0 不得当 0 用）', () => {
    expect(zScoreLast(new Array(60).fill(5), 60)).toBeNull()
  })

  it('rollingCorr 按日期对齐，序列起始日不同不会错位', () => {
    const ndx = Array.from({ length: 80 }, (_, i) => ({ date: `d${i}`, close: 100 * 1.001 ** i }))
    // 宏观序列缺少前 20 天，且日期键一致
    // 起始日晚 10 天 → 交集 70 天 ≥ 61，足够算 60 个收益率
    const dxy = ndx.slice(10).map((p) => ({ date: p.date, close: 90 * 0.999 ** Number(p.date.slice(1)) }))
    const r = rollingCorr(ndx, dxy, 60)
    expect(r).not.toBeNull()
    expect(Math.abs(r as number)).toBeLessThanOrEqual(1)
  })

  it('rollingCorr 样本不足返回 null', () => {
    const a = [{ date: 'd1', close: 1 }, { date: 'd2', close: 2 }]
    expect(rollingCorr(a, a, 60)).toBeNull()
  })
})

describe('M8 宏观压力分与情景矩阵', () => {
  it('raw = clamp(50 + 25z, 0, 100)', () => {
    expect(macroRaw(0)).toBe(50)
    expect(macroRaw(1)).toBe(75)
    expect(macroRaw(-1)).toBe(25)
    expect(macroRaw(3)).toBe(100) // 饱和
    expect(macroRaw(-3)).toBe(0)
    expect(macroRaw(null)).toBeNull()
  })

  it('MPS = 0.30·oil + 0.20·gold + 0.50·dxy', () => {
    expect(mps({ oil: 60, gold: 50, dxy: 80 })).toBeCloseTo(0.3 * 60 + 0.2 * 50 + 0.5 * 80, 10)
    expect(mps({ oil: 50, gold: 50, dxy: 50 })).toBe(50)
  })

  it('缺一个因子时按剩余权重归一化', () => {
    // 只有 oil(.3) 与 dxy(.5)：60*.3 + 80*.5 = 58，÷0.8 = 72.5
    expect(mps({ oil: 60, gold: null, dxy: 80 })).toBeCloseTo(72.5, 10)
  })

  it('八情景归并：三同向压力 +1 / 三同向缓解 −1 / 其余维持', () => {
    expect(macroPattern({ oil: 60, gold: 60, dxy: 60 })).toMatchObject({
      pattern: 'triple_pressure',
      riskBump: 1,
    })
    expect(macroPattern({ oil: 40, gold: 40, dxy: 40 })).toMatchObject({
      pattern: 'triple_relief',
      riskBump: -1,
    })
    expect(macroPattern({ oil: 60, gold: 60, dxy: 40 })).toMatchObject({
      pattern: 'two_pressure',
      riskBump: 0,
    })
    expect(macroPattern({ oil: 40, gold: 40, dxy: 60 })).toMatchObject({
      pattern: 'two_relief',
      riskBump: 0,
    })
  })

  it('有效因子不足 3 个时不做档位调整', () => {
    expect(macroPattern({ oil: 60, gold: 60, dxy: null }).riskBump).toBe(0)
  })

  it('档位调整作用于风险等级而非健康分：H 不变，等级降一档', () => {
    const base = computeScore({ fgi: 23, vxn: 25.56, pePercentile: 43.5, rsiMean: 29.17, macroHealth: null })
    const bumped = computeScore(
      { fgi: 23, vxn: 25.56, pePercentile: 43.5, rsiMean: 29.17, macroHealth: null },
      { riskBump: 1 },
    )
    expect(bumped!.health).toBe(base!.health)
    expect(base!.riskLevel).toBe('偏高')
    expect(bumped!.riskLevel).toBe('高')
    expect(bumped!.baseline!.riskLevel).toBe('偏高')
  })
})

describe('评分子函数单调性（防止分支写反）', () => {
  it('波动分随 VXN 单调不增', () => {
    const xs = [10, 15, 20, 25, 30, 35, 45, 50, 60, 70]
    const ys = xs.map((x) => volatilityScore(x) as number)
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] as number).toBeLessThanOrEqual(ys[i - 1] as number)
    }
  })

  it('波动锚点与 PRD 表一致', () => {
    expect(volatilityScore(15)).toBe(100)
    expect(volatilityScore(20)).toBe(75)
    expect(volatilityScore(25)).toBe(55)
    expect(volatilityScore(30)).toBe(40)
    expect(volatilityScore(35)).toBe(30)
    expect(volatilityScore(50)).toBe(10)
    expect(volatilityScore(60)).toBe(0)
  })

  it('动量分在不健康两端都低、中段高（趋势市两头惩罚）', () => {
    expect(momentumScore(20)).toBe(25)
    expect(momentumScore(40)).toBe(40)
    expect(momentumScore(50)).toBe(60)
    expect(momentumScore(60)).toBe(75)
    expect(momentumScore(80)).toBe(30)
  })
})
