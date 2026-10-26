/** M4 估值 TTM PE。F4.1–F4.4 */

import type { ValuationBlock } from '../../shared/types'
import { PE_BANDS, pickBand } from '../../shared/compute'
import { fmtNum, fmtPct } from '../format'
import { Badge, Panel } from './primitives'

const SEGMENTS = [
  { upTo: 25, color: 'var(--color-lv-ok)', label: '低估' },
  { upTo: 75, color: '#94A3B8', label: '合理' },
  { upTo: 90, color: 'var(--color-lv-warn)', label: '偏贵' },
  { upTo: 100, color: 'var(--color-lv-risk)', label: '高估' },
]

export function M4Valuation({ valuation }: { valuation: ValuationBlock | null }) {
  if (!valuation) {
    return (
      <Panel title="估值 · TTM PE" subtitle="蛋卷指数估值 · 日更">
        <p className="py-8 text-center text-[13px] text-[var(--color-muted)]">估值不可用（蛋卷源失败）</p>
      </Panel>
    )
  }

  const band = pickBand(PE_BANDS, valuation.percentile)
  const p = Math.max(0, Math.min(100, valuation.percentile))

  return (
    <Panel
      title="估值 · TTM PE"
      subtitle={`纳斯达克 100 · 回望 ${valuation.window}`}
      right={<Badge tone={band?.key === 'cheap' ? 'ok' : band?.key === 'fair' ? 'neutral' : 'warn'}>{band?.label}</Badge>}
    >
      <div className="flex items-end justify-between">
        <div>
          <div className="num text-[34px] leading-none font-bold">{fmtNum(valuation.peTTM, 2)}</div>
          <div className="mt-1 text-[12px] text-[var(--color-muted)]">倍 · TTM</div>
        </div>
        <div className="text-right">
          <div className="num text-[20px] leading-none font-semibold text-[var(--color-brand)]">
            {fmtPct(valuation.percentile, 2, false)}
          </div>
          <div className="mt-1 text-[12px] text-[var(--color-muted)]">历史百分位</div>
        </div>
      </div>

      <div className="mt-5">
        <div className="relative h-3 w-full overflow-hidden rounded-full">
          {SEGMENTS.map((s, i) => {
            const from = i === 0 ? 0 : (SEGMENTS[i - 1] as { upTo: number }).upTo
            return (
              <span
                key={s.upTo}
                className="absolute inset-y-0"
                style={{ left: `${from}%`, width: `${s.upTo - from}%`, background: s.color, opacity: 0.55 }}
              />
            )
          })}
          {/* 游标 */}
          <span
            className="absolute -top-1 h-5 w-[3px] rounded-full bg-[var(--color-ink)] shadow"
            style={{ left: `calc(${p}% - 1.5px)` }}
            aria-hidden
          />
        </div>
        <div className="relative mt-1.5 h-4 text-[10.5px] text-[var(--color-muted)]">
          {[0, 25, 75, 90, 100].map((t) => (
            <span key={t} className="num absolute -translate-x-1/2" style={{ left: `${t}%` }}>
              {t}%
            </span>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed">
        当前分位 <span className="num font-semibold">{fmtPct(valuation.percentile, 2, false)}</span>
        ，判为
        <strong className="text-[var(--color-brand)]"> {band?.label}</strong>。{band?.text}
      </p>

      <p className="mt-2 rounded-lg bg-[var(--color-canvas)] px-2.5 py-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
        PE 只衡量估值位置，不衡量盈利质量；分位低不等于买入信号。
      </p>
    </Panel>
  )
}
