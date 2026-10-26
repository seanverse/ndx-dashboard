/** M7 操作建议。F7.1–F7.3 —— 规则引擎输出，非自由文本 */

import { useEffect, useRef, useState } from 'react'
import type { AdviceBlock, ScoreBlock } from '../../shared/types'
import { ADVICE_RULES } from '../../shared/compute'
import { Panel } from './primitives'

/*
 * 卡片配色跟随「风险档位 → 规则」而不是随便挑色：
 * R1 低/偏低=绿（可正常执行）、R2 中性=蓝、R3 偏高=琥珀（需分批）、
 * R4 高 / R5 极高=红（停手）。底色浅、正文色深，保证 4.5:1 以上对比度。
 */
type Tone = { fg: string; bg: string; border: string }

const TONE_BY_RULE: Record<AdviceBlock['ruleId'], Tone> = {
  R1: { fg: '#0a6b38', bg: '#E8F6EE', border: '#CBE8D8' },
  R2: { fg: '#0b57d0', bg: '#E8F0FE', border: '#CFE0FB' },
  R3: { fg: '#8a5200', bg: '#FFF6E5', border: '#F5DFB8' },
  R4: { fg: '#b01f1f', bg: '#FDECEC', border: '#F6CFCF' },
  R5: { fg: '#b01f1f', bg: '#FDECEC', border: '#F6CFCF' },
}

export function M7Advice({ advice, score }: { advice: AdviceBlock | null; score: ScoreBlock | null }) {
  // 规则浮层：点击触发出现在结论带下方，点空白处 / Esc / 再点同一按钮均可关闭
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!advice) {
    return (
      <Panel title="操作建议" subtitle="规则引擎 · 按风险等级映射">
        <p className="py-8 text-center text-[13px] text-[var(--color-muted)]">评分不可用，无法给出建议</p>
      </Panel>
    )
  }

  const tone = TONE_BY_RULE[advice.ruleId] ?? TONE_BY_RULE.R3
  const hit = ADVICE_RULES.find((r) => r.ruleId === advice.ruleId)

  return (
    /*
      不设 panel--auto：与左侧「综合判断」并排时由 grid 拉伸到同高，
      剩余高度交给下面的卡片区吃掉（flex-1），脚注自然贴底，不留空白带。
    */
    <Panel title="操作建议" subtitle="规则驱动，非择时信号">
      {/*
        仓位是「结论」，压成一条横向结论带；规则号 + 短语是这条结论的出处，
        点开才展开五档规则 —— 常驻会把面板撑高，也会把并排的「综合判断」拉出大片空白。
      */}
      <div className="relative" ref={wrapRef}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 rounded-xl border border-[var(--color-line)] px-3.5 py-2.5">
          <span className="text-[11.5px] text-[var(--color-muted)]">建议仓位</span>
          <span className="num text-[28px] leading-none font-bold text-[var(--color-brand)]">
            {advice.position[0]}–{advice.position[1]}%
          </span>
          {score ? (
            <span className="text-[11.5px] text-[var(--color-muted)]">{score.riskLevel} 风险档 · 区间上限</span>
          ) : null}
          {advice.momentumHint ? (
            <span className="text-[11.5px] text-[var(--color-muted)]">
              动量方向：{advice.momentumHint}（仅作提示，不改变仓位档位）
            </span>
          ) : null}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="m7-rule-popover"
            aria-label={`查看五档规则，当前命中 ${advice.ruleId} ${hit?.phrase ?? ''}`}
            className="ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium"
            style={{ color: tone.fg, background: tone.bg, borderColor: tone.border }}
          >
            <span className="num">{advice.ruleId}</span>
            <span aria-hidden>·</span>
            <span>{hit?.phrase}</span>
            <span
              aria-hidden
              className="ml-0.5 inline-flex size-[13px] items-center justify-center rounded-full border border-current text-[9px] leading-none italic"
            >
              i
            </span>
          </button>
        </div>

        {open ? (
          <div
            id="m7-rule-popover"
            role="dialog"
            aria-label="五档规则"
            className="absolute top-full right-0 z-30 mt-2 w-[352px] max-w-full rounded-xl border border-[var(--color-line)] bg-white p-2.5 shadow-[0_14px_36px_rgba(10,37,64,0.16)]"
          >
            <div className="mb-1 flex items-baseline justify-between gap-2 px-1">
              <span className="text-[11.5px] font-medium">五档规则</span>
              <div className="flex items-baseline gap-2">
                <span className="text-[10.5px] text-[var(--color-muted)]">按风险档位固定</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭规则浮层"
                  className="-mr-0.5 px-0.5 text-[13px] leading-none text-[var(--color-muted)]"
                >
                  ×
                </button>
              </div>
            </div>
            <ul className="max-h-[52vh] overflow-y-auto">
              {ADVICE_RULES.map((r) => {
                const isHit = r.ruleId === advice.ruleId
                return (
                  <li
                    key={r.ruleId}
                    className="rounded-md border-t border-[var(--color-line)] px-1.5 py-1.5 text-[11px] leading-snug first:border-t-0"
                    style={
                      isHit
                        ? { background: tone.bg, borderColor: tone.border, boxShadow: `inset 2px 0 0 ${tone.fg}` }
                        : undefined
                    }
                  >
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="num text-[11.5px] font-semibold" style={isHit ? { color: tone.fg } : undefined}>
                        {r.ruleId}
                      </span>
                      <span className="text-[11.5px] font-medium">{r.levels.join(' · ')}</span>
                      <span className="num text-[10.5px] text-[var(--color-muted)]">{r.positionText}</span>
                      <span className="text-[10.5px] text-[var(--color-muted)]">· {r.phrase}</span>
                    </div>
                    <div className="mt-0.5">
                      <span className="text-[var(--color-muted)]">长期定投 </span>
                      <span style={isHit ? { color: tone.fg } : undefined}>{r.longTerm}</span>
                    </div>
                    <div>
                      <span className="text-[var(--color-muted)]">新资金建仓 </span>
                      <span style={isHit ? { color: tone.fg } : undefined}>{r.newMoney}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {/*
        按「容器宽度」而非视口宽度决定是否并排：本面板在 768–1023 是两栏宽、
        ≥1024 是整行宽，视口断点和可用宽度并不同步，容器查询才对。
        门槛取 500px —— 低于此值时卡片内宽不足 225px，最长的一条建议（17 个汉字）
        会被折成两行并留下孤字，不如直接上下堆叠。
      */}
      <div className="@container mt-3 flex min-h-0 flex-1 flex-col">
        <div className="grid flex-1 gap-3 @min-[500px]:grid-cols-2">
          <Card title="长期定投" items={advice.longTerm} tone={tone} />
          <Card title="新资金建仓" items={advice.newMoney} tone={tone} />
        </div>
      </div>

      <p className="mt-3 border-t border-[var(--color-line)] pt-2.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
        仓位为区间上限，不是必须达到的目标；建议只随风险档位（低 → 极高五档）变化，不含个股判断。
      </p>
    </Panel>
  )
}

function Card({ title, items, tone }: { title: string; items: string[]; tone: Tone }) {
  return (
    <div
      data-advice-card=""
      className="flex min-w-0 flex-col justify-center rounded-xl border px-3.5 py-3"
      style={{ background: tone.bg, borderColor: tone.border }}
    >
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.fg }} aria-hidden />
        <span className="text-[12.5px] font-semibold" style={{ color: tone.fg }}>
          {title}
        </span>
      </div>
      <ul className="mt-1.5 space-y-1">
        {items.map((t) => (
          <li key={t} className="text-[13px] leading-relaxed" style={{ color: tone.fg }}>
            {t}
          </li>
        ))}
      </ul>
    </div>
  )
}
