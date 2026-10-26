/** M3 VXN 波动率。F3.1–F3.4 */

import type { VxnBlock } from '../../shared/types'
import { VXN_BANDS, pickBand } from '../../shared/compute'
import { fmtNum, fmtPct, toneClass, toneOf } from '../format'
import { Badge, LevelDot, Meter, Panel } from './primitives'

const DOT: Record<string, 'ok' | 'warn' | 'risk'> = {
  very_low: 'ok',
  low: 'ok',
  normal: 'warn',
  elevated: 'risk',
  high: 'risk',
  extreme: 'risk',
}

export function M3Vxn({ vxn }: { vxn: VxnBlock | null }) {
  if (!vxn) {
    return (
      <Panel title="VXN 波动率" subtitle="CBOE 纳指波动率指数">
        <p className="py-8 text-center text-[13px] text-[var(--color-muted)]">VXN 不可用（CBOE 源失败）</p>
      </Panel>
    )
  }

  const band = pickBand(VXN_BANDS, vxn.value)
  const tone = toneOf(vxn.change)

  return (
    <Panel
      title="VXN 波动率"
      subtitle="CBOE 纳指波动率指数 · 日更"
      right={<Badge tone="neutral">MA20 {fmtNum(vxn.ma20, 2)}</Badge>}
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="num text-[34px] leading-none font-bold">{fmtNum(vxn.value, 2)}</div>
          <div className={`num mt-1 text-[13px] font-medium ${toneClass[tone]}`}>
            {vxn.change > 0 ? '+' : ''}
            {fmtNum(vxn.change, 2)} ({fmtPct(vxn.changePct)})
          </div>
        </div>
        <div className="flex items-center gap-1.5 pb-1">
          <LevelDot level={DOT[vxn.state] ?? 'warn'} />
          <span className="text-[13px] font-semibold">{band?.label}</span>
        </div>
      </div>

      <p className="mt-2 text-[12px] text-[var(--color-muted)]">{band?.text}</p>

      {/* 0–60 映射到 0–100，覆盖常态区间；≥60 视为极高 */}
      <div className="mt-4">
        <Meter
          value={Math.min(100, (vxn.value / 60) * 100)}
          markers={[
            { at: 25, label: '15' },
            { at: 33.3, label: '20' },
            { at: 41.7, label: '25' },
            { at: 58.3, label: '35' },
            { at: 83.3, label: '50' },
          ]}
          segments={[
            { upTo: 25, color: 'var(--color-lv-ok)' },
            { upTo: 33.3, color: 'var(--color-lv-ok)' },
            { upTo: 41.7, color: 'var(--color-lv-warn)' },
            { upTo: 58.3, color: 'var(--color-lv-risk)' },
            { upTo: 83.3, color: 'var(--color-lv-risk)' },
            { upTo: 100, color: 'var(--color-lv-risk)' },
          ]}
          ariaLabel={`VXN ${vxn.value}，${band?.label}`}
        />
      </div>

      <ul className="mt-3 grid grid-cols-3 gap-x-2 gap-y-1 border-t border-[var(--color-line)] pt-2.5 text-[11.5px]">
        {VXN_BANDS.filter((b) => Number.isFinite(b.max)).map((b, i) => {
          const from = i === 0 ? 0 : (VXN_BANDS[i - 1]?.max ?? 0)
          const active = b.key === vxn.state
          return (
            <li
              key={b.key}
              className={`flex items-center gap-1 ${active ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-muted)]'}`}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: DOT[b.key] === 'ok' ? 'var(--color-lv-ok)' : DOT[b.key] === 'warn' ? 'var(--color-lv-warn)' : 'var(--color-lv-risk)', opacity: active ? 1 : 0.4 }}
              />
              <span className="num">
                {from}–{b.max}
              </span>
              <span>{b.label}</span>
            </li>
          )
        })}
        <li
          className={`flex items-center gap-1 ${vxn.state === 'extreme' ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-muted)]'}`}
        >
          <span className="size-1.5 rounded-full" style={{ background: 'var(--color-lv-risk)', opacity: vxn.state === 'extreme' ? 1 : 0.4 }} />
          <span className="num">≥50</span>
          <span>极高</span>
        </li>
      </ul>

      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
        阈值：20 为警戒线、25 为压力线、30–35 为恐慌线。
      </p>
    </Panel>
  )
}
