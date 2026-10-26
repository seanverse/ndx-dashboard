/** M8 宏观三因子。F8.1–F8.6 —— 原油 / 黄金 / 美元指数 + MPS 压力分 */

import type { MacroBlock, MacroFactor } from '../../shared/types'
import { PATTERN_TEXT, MPS_WEIGHTS } from '../../shared/compute'
import { fmtNum, fmtPct, toneClass, toneOf } from '../format'
import { Badge, Panel } from './primitives'

const STATE_TEXT: Record<string, string> = {
  headwind: '压力',
  tailwind: '缓解',
  neutral: '中性',
}

export function M8Macro({ macro }: { macro: MacroBlock | null }) {
  if (!macro) {
    return (
      <Panel title="宏观三因子" subtitle="原油 / 黄金 / 美元指数">
        <p className="py-8 text-center text-[13px] text-[var(--color-muted)]">
          需要日更序列才能计算 z-score 与相关性，当前不可用
        </p>
      </Panel>
    )
  }

  const c = macro.composite
  const tone = c.riskBump > 0 ? 'risk' : c.riskBump < 0 ? 'ok' : 'neutral'

  return (
    <Panel
      title="宏观三因子"
      subtitle="60 日 z-score 标准化 · 三因子上行对股市均为压力"
      right={<Badge tone={tone}>压力分 {fmtNum(c.mps, 1)}</Badge>}
    >
      {/* 情景横幅 */}
      <div
        className="mb-3 rounded-xl px-3 py-2"
        style={{
          background: c.riskBump > 0 ? '#FDECEC' : c.riskBump < 0 ? '#E8F6EE' : 'var(--color-canvas)',
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-[var(--color-ink)]">{PATTERN_TEXT[c.pattern]}</span>
          <span className="num text-[11.5px] text-[var(--color-muted)]">
            {c.riskBump === 0 ? '风险档位维持' : c.riskBump > 0 ? '风险档位上调一级' : '风险档位下调一级'}
          </span>
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3">
        <FactorCard f={macro.oil} weight={MPS_WEIGHTS.oil} />
        <FactorCard f={macro.gold} weight={MPS_WEIGHTS.gold} />
        <FactorCard f={macro.dxy} weight={MPS_WEIGHTS.dxy} />
      </div>

      <div className="mt-3 rounded-xl border border-[var(--color-line)] px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[11.5px] text-[var(--color-muted)]">
            MPS = 0.30·油 + 0.20·金 + 0.50·美元
          </span>
          <span className="num text-[13px] font-semibold">{fmtNum(c.mps, 2)}</span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--color-canvas)]">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${Math.min(100, c.mps)}%`,
              background: c.mps > 66 ? 'var(--color-lv-risk)' : c.mps > 45 ? 'var(--color-lv-warn)' : 'var(--color-lv-ok)',
            }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10.5px] text-[var(--color-muted)]">
          <span>0 全缓解</span>
          <span className="num">宏观健康分 {fmtNum(c.health, 1)}</span>
          <span>100 全压力</span>
        </div>
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
        档位调整在加权之后施加。
        {c.riskBump === 0 ? ' 当前三因子方向不一致，维持原档位。' : ''}
      </p>
    </Panel>
  )
}

function FactorCard({ f, weight }: { f: MacroFactor; weight: number }) {
  const tone1 = toneOf(f.chg1d)
  const tone5 = toneOf(f.chg5d)
  return (
    <div className="rounded-xl border border-[var(--color-line)] px-2.5 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11.5px] font-medium text-[var(--color-muted)]">{f.label}</span>
        <span
          className="text-[10.5px] font-medium"
          style={{
            color:
              f.state === 'headwind'
                ? 'var(--color-lv-risk)'
                : f.state === 'tailwind'
                  ? 'var(--color-lv-ok)'
                  : 'var(--color-muted)',
          }}
        >
          {STATE_TEXT[f.state]}
        </span>
      </div>

      <div className="num mt-0.5 text-[20px] leading-none font-bold">{fmtNum(f.value, f.value > 1000 ? 1 : 2)}</div>

      <dl className="mt-1.5 space-y-0.5 text-[11.5px]">
        <Line k="日环比" v={fmtPct(f.chg1d)} cls={toneClass[tone1]} />
        <Line k="5 日" v={fmtPct(f.chg5d)} cls={toneClass[tone5]} />
        <Line k="HV20" v={fmtPct(f.hv20, 2, false)} cls="text-[var(--color-ink)]" />
        <Line k="corr60" v={fmtNum(f.corr60, 2)} cls="text-[var(--color-ink)]" />
      </dl>

      <div className="mt-2">
        <div className="flex items-center justify-between text-[10.5px] text-[var(--color-muted)]">
          <span>压力分（权 {fmtNum(weight * 100, 0)}%）</span>
          <span className="num">{fmtNum(f.raw, 1)}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-canvas)]">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${Math.min(100, f.raw)}%`,
              background: f.raw > 66 ? 'var(--color-lv-risk)' : f.raw > 45 ? 'var(--color-lv-warn)' : 'var(--color-lv-ok)',
            }}
          />
        </div>
      </div>
    </div>
  )
}

function Line({ k, v, cls }: { k: string; v: string; cls: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <dt className="text-[var(--color-muted)]">{k}</dt>
      <dd className={`num font-medium ${cls}`}>{v}</dd>
    </div>
  )
}
