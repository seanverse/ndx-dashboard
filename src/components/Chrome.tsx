/** 页面骨架：顶部常驻评分条 / 页头 / 页脚 */

import type { DashboardResponse } from '../../shared/types'
import { fmtNum, fmtPct, fmtTime, freshnessText, PHASE_TEXT } from '../format'
import { Badge, Stars } from './primitives'

function riskColor(level: string): string {
  if (level === '低' || level === '偏低') return 'var(--color-lv-ok)'
  if (level === '中性') return 'var(--color-lv-warn)'
  return 'var(--color-lv-risk)'
}

/** 评分维度中文名，仅用于页脚权重说明 */
const DIM_LABEL: Record<string, string> = {
  sentiment: '情绪',
  volatility: '波动',
  valuation: '估值',
  momentum: '动量',
  macro: '宏观',
}

/** 数据源中文名，仅用于页脚来源说明 */
const SOURCE_LABEL: Record<string, string> = {
  ndx: 'NDX 快照',
  oil: 'WTI 原油',
  gold: 'COMEX 黄金',
  dxy: '美元指数',
  fearGreed: '恐贪指数',
  vxn: 'VXN',
  pe: 'TTM PE',
  rsi: 'RSI',
}

/**
 * 顶部常驻评分条。
 * 需求「首屏 3 秒给出风险档位」——所以在移动端也保持 sticky，不必滚动就能看到健康分与仓位。
 */
export function ScoreBar({ data, onRefresh, refreshing }: { data: DashboardResponse; onRefresh: () => void; refreshing: boolean }) {
  const s = data.score
  const pos = data.advice?.position
  return (
    <div className="sticky-score">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-5 gap-y-1.5 px-3 py-2 sm:px-5">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] text-[var(--color-muted)]">健康分</span>
          <span className="num text-[20px] leading-none font-bold">{s ? fmtNum(s.health, 1) : '—'}</span>
          {s ? <Stars value={s.stars} size={14} /> : null}
        </div>

        {s ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] text-[var(--color-muted)]">风险</span>
            <span className="text-[14px] font-semibold" style={{ color: riskColor(s.riskLevel) }}>
              {s.riskLevel}
            </span>
          </div>
        ) : null}

        {pos ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] text-[var(--color-muted)]">仓位</span>
            <span className="num text-[14px] font-semibold text-[var(--color-brand)]">
              {pos[0]}–{pos[1]}%
            </span>
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <span className="num hidden text-[11px] text-[var(--color-muted)] sm:inline">
            {data.meta.tradeDate} 收盘 · 采集 {fmtTime(data.meta.generatedAt).slice(11)}
          </span>
          <Badge tone={data.meta.stale ? 'warn' : 'ok'}>
            {data.meta.stale ? '数据陈旧' : (PHASE_TEXT[data.meta.phase] ?? data.meta.phase)}
          </Badge>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="rounded-md border border-[var(--color-line)] px-2 py-0.5 text-[11.5px] text-[var(--color-brand)] disabled:opacity-50"
          >
            {refreshing ? '刷新中' : '刷新'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PageHeader({ data }: { data: DashboardResponse }) {
  return (
    <header className="pt-4 pb-3 sm:pt-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[20px] font-bold tracking-tight sm:text-[24px]">NASDAQ-100 市场情绪监测</h1>
        <span className="num text-[12.5px] text-[var(--color-muted)]">{freshnessText(data.meta)}</span>
      </div>
      {data.meta.warnings.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {data.meta.warnings.slice(0, 4).map((w) => (
            <li key={w}>
              <Badge tone="warn">{w}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  )
}

export function PageFooter({ data }: { data: DashboardResponse }) {
  const sources = Object.entries(data.meta.sources)
    .filter(([, v]) => v !== 'missing')
    .map(([k, v]) => `${SOURCE_LABEL[k] ?? k} ← ${v}`)
    .join(' · ')

  return (
    <footer className="mx-auto max-w-[1200px] px-3 pt-2 pb-10 text-[11px] leading-relaxed text-[var(--color-muted)] sm:px-5">
      <p className="border-t border-[var(--color-line)] pt-3">
        本页为指标计算与规则化提示，不构成投资建议。数据来自公开免费接口，存在分发延迟与统计口径差异；
        当前数据为 {freshnessText(data.meta)}。
        {data.meta.stale ? ' 本次抓取失败，展示的是上一版数据。' : ''}
      </p>
      <p className="num mt-1 opacity-80">
        源：{sources || '—'} · 刷新周期 15 分钟 · 综合评分模型 {data.score?.model ?? '—'}
      </p>
      <p className="mt-1 opacity-70">
        权重：
        {data.score
          ? Object.entries(data.score.weights)
              .map(([k, v]) => `${DIM_LABEL[k] ?? k} ${fmtPct(v * 100, 0, false)}`)
              .join(' / ')
          : '—'}
      </p>
    </footer>
  )
}

/** 首访无数据。前端对 503 显示「数据准备中」，不显示报错（TECH-001 §5.1 边界 3） */
export function NotReady() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[560px] flex-col items-center justify-center px-4 text-center">
      <div className="text-[18px] font-semibold">数据准备中</div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted)]">
        首次加载需要先完成一次采集，通常在几分钟内就绪。请稍后刷新页面。
      </p>
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[560px] flex-col items-center justify-center px-4 text-center">
      <div className="text-[18px] font-semibold text-[var(--color-lv-risk)]">加载失败</div>
      <p className="num mt-2 text-[12.5px] break-all text-[var(--color-muted)]">{message}</p>
    </div>
  )
}

export function Skeleton() {
  return (
    <div className="mx-auto max-w-[1200px] animate-pulse px-3 pt-6 sm:px-5">
      <div className="h-7 w-64 rounded bg-[var(--color-line)]" />
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-44 rounded-2xl bg-[var(--color-line)] opacity-60" />
        ))}
      </div>
    </div>
  )
}
