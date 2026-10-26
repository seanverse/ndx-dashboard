/** M1 今日概览。F1.1–F1.6 */

import type { Meta, Quote } from '../../shared/types'
import { fmtNum, fmtPct, fmtPoint, fmtTime, fmtVolume, toneClass, toneOf, PHASE_TEXT } from '../format'
import { Badge, Panel } from './primitives'

export function M1Quote({ quote, meta }: { quote: Quote | null; meta: Meta }) {
  if (!quote) {
    return (
      <Panel title="今日概览" subtitle="NDX · 纳斯达克 100">
        <p className="py-8 text-center text-[13px] text-[var(--color-muted)]">行情不可用，等待下一次采集</p>
      </Panel>
    )
  }

  const tone = toneOf(quote.change)

  return (
    <Panel
      title="今日概览"
      subtitle="NDX · 纳斯达克 100 指数"
      right={
        <div className="text-right">
          <Badge tone={meta.stale ? 'warn' : 'brand'}>{meta.stale ? '数据陈旧' : PHASE_TEXT[meta.phase] ?? meta.phase}</Badge>
          <div className="num mt-1 text-[10.5px] text-[var(--color-muted)]">
            {meta.phase === 'open' ? `快照 ${fmtTime(meta.generatedAt).slice(11)}` : `${meta.tradeDate} 收盘`}
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <span className="num text-[42px] leading-none font-bold tracking-tight sm:text-[52px] lg:text-[58px]">
          {fmtPoint(quote.close)}
        </span>
        <span className={`num text-[15px] font-semibold ${toneClass[tone]}`}>
          {quote.change > 0 ? '+' : ''}
          {fmtPoint(quote.change)} ({fmtPct(quote.changePct)})
        </span>
      </div>

      <dl className="mt-auto grid min-w-0 grid-cols-2 gap-x-4 gap-y-0 border-t border-[var(--color-line)] pt-3 sm:grid-cols-3">
        <Cell k="今开" v={fmtPoint(quote.open)} />
        <Cell k="最高" v={fmtPoint(quote.high)} />
        <Cell k="最低" v={fmtPoint(quote.low)} />
        <Cell k="昨收" v={fmtPoint(quote.prevClose)} />
        <Cell k="振幅" v={fmtPct(quote.amplitude, 2, false)} />
        <Cell k="成交量" v={fmtVolume(quote.volume)} />
      </dl>

      <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
        涨跌幅与振幅的分母均为<strong className="text-[var(--color-ink)]">昨收</strong>。成交量为成分股合计，对价格指数无直接经济含义。
      </p>
    </Panel>
  )
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 py-1.5">
      <dt className="min-w-0 shrink truncate text-[12.5px] text-[var(--color-muted)]">{k}</dt>
      <dd className="num shrink-0 text-[13.5px] font-medium whitespace-nowrap">{v}</dd>
    </div>
  )
}
