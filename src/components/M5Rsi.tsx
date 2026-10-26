/** M5 RSI 动量。F5.1–F5.5 */

import type { RsiBlock } from '../../shared/types'
import { RSI_BANDS, pickBand } from '../../shared/compute'
import { fmtNum } from '../format'
import { Badge, Meter, Panel } from './primitives'

const STATE_COLOR: Record<string, string> = {
  oversold: 'var(--color-down)',
  weak: '#4C9A6B',
  neutral: 'var(--color-muted)',
  strong: '#C77700',
  overbought: 'var(--color-up)',
}

export function M5Rsi({ rsi }: { rsi: RsiBlock | null }) {
  if (!rsi) {
    return (
      <Panel title="RSI 动量" subtitle="RSI6 / RSI12 / RSI24 · 日线 · 日更">
        <p className="py-8 text-center text-[13px] text-[var(--color-muted)]">RSI 不可用（NDX 日K 失败）</p>
      </Panel>
    )
  }

  const combined = pickBand(RSI_BANDS, rsi.mean)
  const cards = [
    { label: 'RSI6', short: '短线', value: rsi.rsi6 },
    { label: 'RSI12', short: '中短线', value: rsi.rsi12 },
    { label: 'RSI24', short: '中期', value: rsi.rsi24 },
  ]

  return (
    <Panel
      title="RSI 动量"
      subtitle="Wilder 平滑 · 与通达信 SMA(X,N,1) 等价"
      right={
        <Badge tone={rsi.consistency ? 'neutral' : 'warn'}>
          {rsi.consistency ? '三期一致' : '三期分歧'}
        </Badge>
      }
    >
      <div className="grid grid-cols-3 gap-2.5">
        {cards.map((c) => {
          const band = pickBand(RSI_BANDS, c.value)
          return (
            <div key={c.label} className="rounded-xl border border-[var(--color-line)] p-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[11.5px] font-medium text-[var(--color-muted)]">{c.label}</span>
                <span className="text-[10.5px] text-[var(--color-muted)]">{c.short}</span>
              </div>
              <div className="num mt-1 text-[22px] leading-none font-bold" style={{ color: STATE_COLOR[band?.key ?? 'neutral'] }}>
                {fmtNum(c.value, 3)}
              </div>
              <div className="mt-1 text-[11.5px] font-medium" style={{ color: STATE_COLOR[band?.key ?? 'neutral'] }}>
                {band?.label}
              </div>
              <div className="mt-2">
                <Meter
                  value={c.value}
                  markers={[
                    { at: 30, label: '30' },
                    { at: 50, label: '50' },
                    { at: 70, label: '70' },
                  ]}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--color-canvas)] px-3 py-2.5">
        <div>
          <div className="text-[11.5px] text-[var(--color-muted)]">综合信号（三期均值）</div>
          <div className="flex items-baseline gap-2">
            <span className="num text-[18px] font-bold">{fmtNum(rsi.mean, 2)}</span>
            <span className="text-[13px] font-semibold" style={{ color: STATE_COLOR[combined?.key ?? 'neutral'] }}>
              {combined?.label}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11.5px] text-[var(--color-muted)]">动量方向 D = RSI6 − RSI24</div>
          <div className="num text-[13px] font-semibold">
            {fmtNum(rsi.rsi6 - rsi.rsi24, 2)}{' '}
            <span className="text-[11.5px] font-normal text-[var(--color-muted)]">
              {rsi.slope === 'down' ? '下行加速' : rsi.slope === 'up' ? '上行加速' : '同步'}
            </span>
          </div>
        </div>
      </div>

      <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
        RSI &lt; 30 判为
        <strong className="text-[var(--color-ink)]">超卖</strong>，&gt; 70 判为超买。
        {rsi.rsi6 < 30 && rsi.rsi12 < 30 ? ' 当前短周期两线均已跌破 30，属超跌区间。' : ''}
      </p>
    </Panel>
  )
}
