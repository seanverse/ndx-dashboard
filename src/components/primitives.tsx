/**
 * 自绘 SVG / CSS 原子。零第三方图表库。
 *
 * 理由（TECH-001 §3.1）：六个可视化都是「定长几何 + 阈值着色」，无大数据量坐标轴。
 * 引 ECharts 约 1 MB 换不到能力，而首屏 3 秒出结论是核心成功标准。
 */

import type { ReactNode } from 'react'

// ---------- 容器 ----------

export function Panel({
  title,
  subtitle,
  right,
  children,
  className = '',
  id,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section id={id} className={`panel p-4 sm:p-5 ${className}`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-wide text-[var(--color-muted)]">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">{subtitle}</p> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: 'neutral' | 'brand' | 'risk' | 'warn' | 'ok'
  className?: string
}) {
  const map = {
    neutral: 'bg-[var(--color-canvas)] text-[var(--color-muted)] border-[var(--color-line)]',
    brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand)] border-transparent',
    risk: 'bg-[#FDECEC] text-[var(--color-lv-risk)] border-transparent',
    warn: 'bg-[#FFF6E5] text-[var(--color-lv-warn)] border-transparent',
    ok: 'bg-[#E8F6EE] text-[var(--color-lv-ok)] border-transparent',
  } as const
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${map[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function LevelDot({ level }: { level: 'ok' | 'warn' | 'risk' }) {
  const color = {
    ok: 'var(--color-lv-ok)',
    warn: 'var(--color-lv-warn)',
    risk: 'var(--color-lv-risk)',
  }[level]
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)` }}
    />
  )
}

// ---------- 星级 ----------

/** 0.5 星粒度。底灰星 + 蓝色星按百分比裁切，避免为半星画两套 path */
export function Stars({ value, size = 18 }: { value: number; size?: number }) {
  const pct = Math.max(0, Math.min(1, value / 5)) * 100
  return (
    <span
      className="relative inline-block select-none whitespace-nowrap leading-none"
      style={{ fontSize: size }}
      role="img"
      aria-label={`${value} 星，满分 5 星`}
    >
      <span style={{ color: 'var(--color-line)' }}>★★★★★</span>
      <span
        className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap"
        style={{ width: `${pct}%`, color: 'var(--color-brand)' }}
      >
        ★★★★★
      </span>
    </span>
  )
}

// ---------- 半环仪表 ----------

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) }
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const a = polar(cx, cy, r, fromDeg)
  const b = polar(cx, cy, r, toDeg)
  const large = Math.abs(fromDeg - toDeg) > 180 ? 1 : 0
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

/** 角度：value 0 → 180°（左），value 100 → 0°（右） */
function degOf(value: number, min = 0, max = 100): number {
  const v = Math.max(min, Math.min(max, value))
  return 180 - ((v - min) / (max - min)) * 180
}

/**
 * 0–100 半环仪表。
 * 扇区按 CNN 真实阈值 25 / 45 / 56 / 76 绘制，不是五等分 —— 这是修参考图 D1：
 * 原图刻度标 0/20/40/60/80 与分档阈值错位，指针 23 会视觉落在「20 恐惧」右侧却标「极度恐惧」。
 */
export function Gauge({
  value,
  thresholds = [25, 45, 56, 76],
  colors,
  labels,
}: {
  value: number
  thresholds?: number[]
  colors?: string[]
  labels?: string[]
}) {
  const w = 200
  const h = 116
  const cx = w / 2
  const cy = 100
  const r = 78
  const bandColors =
    colors ?? ['#C0392B', '#E08A3C', '#B8A34A', '#4C9A6B', '#0A8F4A']
  const bounds = [0, ...thresholds, 100]

  const needleDeg = degOf(value)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[210px]" role="img" aria-label={`当前值 ${value}`}>
      {bounds.slice(0, -1).map((from, i) => {
        const to = bounds[i + 1] as number
        return (
          <path
            key={from}
            d={arcPath(cx, cy, r, degOf(from), degOf(to))}
            stroke={bandColors[i] ?? '#ccc'}
            strokeWidth={15}
            fill="none"
            strokeLinecap="butt"
            opacity={0.92}
          />
        )
      })}
      {/* 刻度：用真实阈值，标签即分档起点 */}
      {thresholds.map((t) => {
        const p1 = polar(cx, cy, r - 9, degOf(t))
        const p2 = polar(cx, cy, r + 9, degOf(t))
        return (
          <line
            key={`t${t}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke="#fff"
            strokeWidth={2}
            opacity={0.9}
          />
        )
      })}
      {/* 指针 */}
      <line
        x1={cx}
        y1={cy}
        x2={polar(cx, cy, r - 16, needleDeg).x}
        y2={polar(cx, cy, r - 16, needleDeg).y}
        stroke="var(--color-ink)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={5} fill="var(--color-ink)" />
      <text
        x={cx}
        y={cy - 26}
        textAnchor="middle"
        className="num"
        style={{ fontSize: 26, fontWeight: 700, fill: 'var(--color-ink)' }}
      >
        {Math.round(value * 10) / 10}
      </text>
      {labels ? (
        <>
          <text x={cx - r} y={cy + 14} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--color-muted)' }}>
            {labels[0]}
          </text>
          <text x={cx + r} y={cy + 14} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--color-muted)' }}>
            {labels[1]}
          </text>
        </>
      ) : null}
    </svg>
  )
}

// ---------- 横向刻度条 ----------

/**
 * 带阈值刻度的横向条，用于 RSI / 估值百分位。
 * markers 是阈值位置（0–100 域），position 是当前值。
 */
export function Meter({
  value,
  markers,
  segments,
  ariaLabel,
}: {
  value: number
  markers: { at: number; label?: string }[]
  segments?: { upTo: number; color: string }[]
  ariaLabel?: string
}) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="w-full">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-canvas)]">
        {segments?.map((s, i) => {
          const from = i === 0 ? 0 : (segments[i - 1] as { upTo: number }).upTo
          return (
            <span
              key={s.upTo}
              className="absolute inset-y-0"
              style={{ left: `${from}%`, width: `${s.upTo - from}%`, background: s.color, opacity: 0.35 }}
            />
          )
        })}
        <span
          className="absolute inset-y-0 w-[3px] rounded-full bg-[var(--color-ink)]"
          style={{ left: `calc(${v}% - 1.5px)` }}
        />
      </div>
      <div className="relative mt-1 h-4">
        {markers.map((m) => (
          <span
            key={m.at}
            className="num absolute -translate-x-1/2 text-[10.5px] text-[var(--color-muted)]"
            style={{ left: `${m.at}%` }}
          >
            {m.label ?? m.at}
          </span>
        ))}
      </div>
      <span className="sr-only">{ariaLabel ?? `当前 ${v}`}</span>
    </div>
  )
}

// ---------- 迷你折线 ----------

export function Sparkline({
  points,
  height = 34,
  stroke = 'var(--color-brand)',
}: {
  points: number[]
  height?: number
  stroke?: string
}) {
  if (points.length < 2) return <div style={{ height }} />
  const w = 100
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w
      const y = height - ((p - min) / span) * (height - 4) - 2
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// ---------- 键值行 ----------

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <dt className="text-[12.5px] text-[var(--color-muted)]">{k}</dt>
      <dd className="num text-[13px] font-medium text-[var(--color-ink)]">{children}</dd>
    </div>
  )
}
