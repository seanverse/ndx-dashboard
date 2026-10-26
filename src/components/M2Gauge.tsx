/** M2 CNN 恐贪指数。F2.1–F2.5 */

import { useState } from 'react'
import type { FearGreed } from '../../shared/types'
import { FGI_BANDS, FGI_COMPONENT_LABELS, FGI_THRESHOLDS, pickBand } from '../../shared/compute'
import { fmtNum, fmtPct } from '../format'
import { Badge, Gauge, Panel } from './primitives'

export function M2Gauge({ fearGreed }: { fearGreed: FearGreed | null }) {
  const [open, setOpen] = useState(false)

  if (!fearGreed) {
    return (
      <Panel title="恐贪指数" subtitle="CNN Fear & Greed">
        <p className="py-8 text-center text-[13px] text-[var(--color-muted)]">恐贪数据不可用</p>
      </Panel>
    )
  }

  const band = pickBand(FGI_BANDS, fearGreed.score)
  const delta = fearGreed.prevClose === null ? null : fearGreed.score - fearGreed.prevClose

  return (
    <Panel
      title="恐贪指数"
      subtitle="CNN Fear & Greed · 0–100"
      right={<Badge tone="neutral">底层 S&amp;P 500</Badge>}
    >
      <div className="flex flex-col items-center">
        <Gauge value={fearGreed.score} thresholds={[...FGI_THRESHOLDS]} labels={['0 恐惧', '100 贪婪']} />
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[15px] font-semibold" style={{ color: scoreColor(fearGreed.score) }}>
            {band?.label ?? '—'}
          </span>
          {delta !== null ? (
            <span className="num text-[12px] text-[var(--color-muted)]">较前收 {fmtPct(delta, 1)}</span>
          ) : null}
        </div>
        <p className="mt-1 text-center text-[12px] text-[var(--color-muted)]">{band?.text}</p>
      </div>

      <dl className="mt-4 grid grid-cols-4 gap-1 border-t border-[var(--color-line)] pt-3 text-center">
        <Mini k="前收" v={fearGreed.prevClose} />
        <Mini k="一周" v={fearGreed.oneWeek} />
        <Mini k="一月" v={fearGreed.oneMonth} />
        <Mini k="一年" v={fearGreed.oneYear} />
      </dl>

      {fearGreed.components.length > 0 ? (
        <div className="mt-3 border-t border-[var(--color-line)] pt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between py-1 text-[12.5px] text-[var(--color-brand)]"
            aria-expanded={open}
          >
            <span>七个子指标（各占 1/7）</span>
            <span className="num">{open ? '收起' : '展开'}</span>
          </button>
          {open ? (
            <ul className="mt-2 space-y-1.5">
              {fearGreed.components.map((c) => (
                <li key={c.key} className="flex items-center gap-2">
                  <span className="w-[68px] shrink-0 text-[12px] text-[var(--color-muted)]">
                    {FGI_COMPONENT_LABELS[c.key] ?? c.key}
                  </span>
                  <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-canvas)]">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${c.score}%`, background: scoreColor(c.score) }}
                    />
                  </span>
                  <span className="num w-9 text-right text-[11.5px]">{fmtNum(c.score, 1)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
        底层为 <strong className="text-[var(--color-ink)]">S&amp;P 500</strong>（子指标 SPX / VIX / NYSE 广度），
        对 NDX 是代理指标，科技股与大盘背离时会误导。
      </p>
    </Panel>
  )
}

function Mini({ k, v }: { k: string; v: number | null }) {
  return (
    <div>
      <dt className="text-[11px] text-[var(--color-muted)]">{k}</dt>
      <dd className="num text-[13px] font-medium">{v === null ? '—' : fmtNum(v, 1)}</dd>
    </div>
  )
}

function scoreColor(score: number): string {
  if (score < 25) return 'var(--color-lv-risk)'
  if (score < 45) return '#E08A3C'
  if (score < 56) return 'var(--color-lv-warn)'
  if (score < 76) return '#4C9A6B'
  return 'var(--color-lv-ok)'
}
