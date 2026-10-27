/**
 * M7 操作建议：规则引擎，非自由文本。PRD-001 §3.8。
 * 输入只有风险等级与动量方向，输出「仓位区间 + 长期定投 / 新资金建仓两栏」固定文案 ——
 * 给定等级，文案必须唯一确定（验收 A4）。
 */

import type { AdviceBlock, MomentumSlope, RiskLevel, RuleId } from '../types.js'
import { POSITION_BY_RISK } from './bands.js'

type Rule = Omit<AdviceBlock, 'momentumHint'>

const R1: Rule = {
  ruleId: 'R1',
  position: POSITION_BY_RISK['低'],
  longTerm: ['维持持仓，不追高'],
  newMoney: ['按计划投入，不做择时'],
}

const R2: Rule = {
  ruleId: 'R2',
  position: POSITION_BY_RISK['中性'],
  longTerm: ['维持持仓，检查单一标的集中度'],
  newMoney: ['分批投入，单批不超计划额 1/3'],
}

const R3: Rule = {
  ruleId: 'R3',
  position: POSITION_BY_RISK['偏高'],
  longTerm: ['维持持有，不因短期波动改变长期计划'],
  newMoney: ['分 2–3 批投入，不一次性重仓'],
}

const R4: Rule = {
  ruleId: 'R4',
  position: POSITION_BY_RISK['高'],
  longTerm: ['不加仓；再平衡回目标权重'],
  newMoney: ['暂停新增，转为观察'],
}

const R5: Rule = {
  ruleId: 'R5',
  position: POSITION_BY_RISK['极高'],
  longTerm: ['降低风险敞口，保留现金'],
  newMoney: ['不投入，等待情绪修复'],
}

const RULE_BY_RISK: Record<RiskLevel, Rule> = {
  低: R1,
  偏低: R1,
  中性: R2,
  偏高: R3,
  高: R4,
  极高: R5,
}

const HINT: Record<MomentumSlope, string> = {
  down: '短期弱于长期，下行加速',
  up: '短期强于长期，上行加速',
  flat: '三周期同步，方向待确认',
}

/**
 * 动量方向只追加一句提示，不改变仓位档位。
 * slope 为 null 时留空字符串，避免 UI 出现 "undefined"。
 */
export function buildAdvice(riskLevel: RiskLevel, slope: MomentumSlope | null): AdviceBlock {
  const rule = RULE_BY_RISK[riskLevel]
  return { ...rule, momentumHint: slope === null ? '' : HINT[slope] }
}

/**
 * 规则清单：面板上「五档规则」表的唯一数据源，与 RULE_BY_RISK 同源，不另写一份文案。
 * 顺序按风险由低到高，与界面阅读方向一致（越往下越危险）。
 */
export interface AdviceRuleRow {
  ruleId: RuleId
  /** 该规则覆盖的风险档位，R1 同时覆盖「低」「偏低」 */
  levels: readonly RiskLevel[]
  /** 展示用仓位，随 POSITION_BY_RISK 联动 */
  positionText: string
  /** 规则短语：取自该档「新资金建仓」的核心动作，用于命中标识与规则浮层标题 */
  phrase: string
  longTerm: string
  newMoney: string
}

const RULE_LIST: readonly { ruleId: RuleId; levels: readonly RiskLevel[]; rule: Rule; phrase: string }[] = [
  { ruleId: 'R1', levels: ['低', '偏低'], rule: R1, phrase: '按计划投入' },
  { ruleId: 'R2', levels: ['中性'], rule: R2, phrase: '分批投入' },
  { ruleId: 'R3', levels: ['偏高'], rule: R3, phrase: '分 2–3 批' },
  { ruleId: 'R4', levels: ['高'], rule: R4, phrase: '暂停新增' },
  { ruleId: 'R5', levels: ['极高'], rule: R5, phrase: '降低敞口' },
]

export const ADVICE_RULES: readonly AdviceRuleRow[] = RULE_LIST.map(({ ruleId, levels, rule, phrase }) => ({
  ruleId,
  levels,
  positionText: levels.map((l) => `${POSITION_BY_RISK[l][0]}–${POSITION_BY_RISK[l][1]}%`).join(' / '),
  phrase,
  longTerm: rule.longTerm.join('；'),
  newMoney: rule.newMoney.join('；'),
}))

export const DISCLAIMER =
  '本页为指标计算与规则化提示，不构成投资建议。数据来源为公开免费接口，存在延迟与口径差异。'
