/** M6 综合判断。F6.1–F6.4 —— 四维状态卡 + 星级 + 维度明细 */

import type { ScoreBlock } from '../../shared/types'
import { FGI_BANDS, PE_BANDS, pickBand } from '../../shared/compute'
import { fmtNum, fmtPct } from '../format'
import { Badge, Panel, Stars } from './primitives'

const DIM_META: { key: 'sentiment' | 'volatility' | 'valuation' | 'momentum' | 'macro'; label: string; hint: string }[] = [
  { key: 'sentiment', label: '情绪', hint: 'CNN 恐贪' },
  { key: 'volatility', label: '波动', hint: 'VXN 分段线性' },
  { key: 'valuation', label: '估值', hint: '100 − 百分位' },
  { key: 'momentum', label: '动量', hint: 'RSI 均值分档' },
]

/** 维度分 → 色。60 以上视为健康 */
function dimColor(score: number | null): string {
  if (score === null) return 'var(--color-muted)'
  if (score >= 70) return 'var(--color-lv-ok)'
  if (score >= 50) return 'var(--color-lv-warn)'
  return 'var(--color-lv-risk)'
}

export function M6Score({
  score,
  riskBandText,
}: {
  score: ScoreBlock | null
  riskBandText?: string
}) {
  if (!score) {
    return (
      <Panel title="综合判断" subtitle="四维健康分等权平均" className="panel--auto">
        <p className="py-8 text-center text-[13px] text-[var(--color-muted)]">数据不足，无法评分</p>
      </Panel>
    )
  }

  const dims = DIM_META.filter((d) => score.dims[d.key] !== undefined)

  return (
    /*
      明细表常驻显示（不再折叠）。这个面板可能在整行，也可能是半屏配对里的左格，
      所以内部分栏同样按容器宽度切，不用视口断点。
    */
    <Panel title="综合判断" subtitle={`模型 ${score.model} · 健康分 = 四维等权平均`} className="">
      <div className="@container flex flex-1 flex-col">
        <div className="@min-[900px]:flex @min-[900px]:items-center @min-[900px]:gap-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 @min-[900px]:shrink-0">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="num text-[40px] leading-none font-bold">{fmtNum(score.health, 1)}</span>
                <span className="text-[12px] text-[var(--color-muted)]">/ 100</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Stars value={score.stars} />
                <span className="num text-[12.5px] text-[var(--color-muted)]">{fmtNum(score.stars, 1)} / 5</span>
              </div>
            </div>

            <div className="min-w-[110px]">
              <div className="text-[11.5px] text-[var(--color-muted)]">风险等级</div>
              <div className="text-[20px] leading-tight font-bold" style={{ color: riskColor(score.riskLevel) }}>
                {score.riskLevel}
              </div>
              {riskBandText ? <div className="text-[11px] text-[var(--color-muted)]">{riskBandText}</div> : null}
            </div>

            {score.riskBump !== 0 && score.baseline ? (
              <Badge tone={score.riskBump > 0 ? 'risk' : 'ok'}>
                宏观情景已调整档位 {score.riskBump > 0 ? '↑' : '↓'}（基准 {score.baseline.riskLevel}）
              </Badge>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 @min-[500px]:grid-cols-4 @min-[900px]:mt-0 @min-[900px]:flex-1">
            {dims.map((d) => {
              const v = score.dims[d.key] ?? null
              const w = score.weights[d.key] ?? 0
              return (
                <div key={d.key} className="min-w-0 rounded-xl border border-[var(--color-line)] px-2.5 py-2">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-[11.5px] text-[var(--color-muted)]">{d.label}</span>
                    <span className="num shrink-0 text-[10px] text-[var(--color-muted)]">
                      {w > 0 ? `${fmtPct(w * 100, 0, false)}` : '不计入'}
                    </span>
                  </div>
                  <div className="num mt-0.5 text-[20px] leading-none font-bold" style={{ color: dimColor(v) }}>
                    {v === null ? '—' : fmtNum(v, 1)}
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--color-canvas)]">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${v === null ? 0 : v}%`, background: dimColor(v) }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 余量吸收层：与右侧配对时多出的高度落在这里，明细表仍贴着卡片底部 */}
        <div className="flex-1" aria-hidden />

        <div className="mt-3 overflow-x-auto border-t border-[var(--color-line)] pt-3">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[var(--color-muted)]">
                <th className="py-1 pr-2 font-medium">维度</th>
                <th className="py-1 pr-2 font-medium">输入</th>
                <th className="py-1 pr-2 font-medium">命中区间</th>
                <th className="py-1 text-right font-medium">得分</th>
              </tr>
            </thead>
            <tbody className="num">
              <Row
                label="情绪"
                input="恐贪"
                range={pickBand(FGI_BANDS, score.dims.sentiment ?? null)?.label ?? '—'}
                score={score.dims.sentiment}
              />
              <Row label="波动" input="VXN" range={vxnRange(score.dims.volatility)} score={score.dims.volatility} />
              <Row
                label="估值"
                input="百分位"
                range={pickBand(PE_BANDS, 100 - (score.dims.valuation ?? 0))?.label ?? '—'}
                score={score.dims.valuation}
              />
              <Row
                label="动量"
                input="RSI 均值"
                range={rsiRange(score.dims.momentum)}
                score={score.dims.momentum}
              />
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
            权重为四维等权 25%。缺数维度不计 0 分，按剩余权重重分配，因此缺数时实际权重会大于名义值。
          </p>
        </div>
      </div>
    </Panel>
  )
}

function Row({
  label,
  input,
  range,
  score,
}: {
  label: string
  input: string
  range: string
  score: number | null | undefined
}) {
  return (
    <tr className="border-t border-[var(--color-line)]">
      <td className="py-1.5 pr-2 whitespace-nowrap">{label}</td>
      <td className="py-1.5 pr-2 whitespace-nowrap text-[var(--color-muted)]">{input}</td>
      <td className="py-1.5 pr-2 text-[var(--color-muted)]">{range}</td>
      <td className="py-1.5 text-right font-medium whitespace-nowrap">
        {score === null || score === undefined ? '—' : fmtNum(score, 1)}
      </td>
    </tr>
  )
}

/** 反查：维度分 → 对应的 VXN 区间标签（分段线性不可逆，用就近锚点近似） */
function vxnRange(score: number | null | undefined): string {
  if (score === null || score === undefined) return '—'
  if (score >= 100) return '< 15'
  if (score >= 75) return '15 – 20'
  if (score >= 55) return '20 – 25'
  if (score >= 40) return '25 – 30'
  if (score >= 30) return '30 – 35'
  if (score >= 10) return '35 – 50'
  return '≥ 50'
}

function rsiRange(score: number | null | undefined): string {
  if (score === null || score === undefined) return '—'
  const map: Record<number, string> = { 25: '< 30 超卖', 40: '30 – 45 偏弱', 60: '45 – 55 中性', 75: '55 – 70 偏强', 30: '≥ 70 超买' }
  return map[score] ?? `${fmtNum(score, 0)}`
}

function riskColor(level: string): string {
  if (level === '低' || level === '偏低') return 'var(--color-lv-ok)'
  if (level === '中性') return 'var(--color-lv-warn)'
  return 'var(--color-lv-risk)'
}
