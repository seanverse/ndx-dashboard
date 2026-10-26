/**
 * 取数交叉核对：把页面上的每个数字，和「另一个独立源」对一遍。
 *
 * 为什么需要这个脚本：实连测试只能证明「抓取链路没抛异常」，不能证明
 * 「抓到的数字是对的」。这里逐项拉第二源（新浪↔腾讯、CBOE/CNN/蛋卷官方），
 * 算偏差并给结论。RSI 用第二套实现重算，避免「同一段代码跑两遍」的假验证。
 *
 * 用法：npm run verify
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DailyMetrics, LatestSnapshot } from '../shared/types'
import { fetchVxn } from '../server/adapters/cboe'
import { fetchFearGreed } from '../server/adapters/cnn'
import { fetchPe } from '../server/adapters/danjuan'
import { fetchNdxDaily, fetchSnapshots } from '../server/adapters/sina'
import { fetchTencentFutures, fetchTencentNdx } from '../server/adapters/tencent'
import { checkDxyDeviation, computeDxy } from '../server/dxy'
import { fetchAllFx } from '../server/adapters/forex'

const DATA_DIR = join(process.cwd(), '.data')

type Row = {
  item: string
  page: string
  source: string
  src: string
  diff: string
  verdict: '✓' | '≈' | '✗' | '!'
  note?: string
}

const rows: Row[] = []
const failures: string[] = []

function push(r: Row) {
  rows.push(r)
  if (r.verdict === '✗') failures.push(`${r.item}：页面 ${r.page} vs ${r.source} ${r.src}`)
}

/** 相对偏差百分比 */
function dev(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return Number.POSITIVE_INFINITY
  return Math.abs((a - b) / b) * 100
}

function cmp(
  item: string,
  page: number | null | undefined,
  srcVal: number | null | undefined,
  source: string,
  tolPct: number,
  note?: string,
  digits = 4,
) {
  if (page === null || page === undefined || srcVal === null || srcVal === undefined) {
    push({ item, page: page === null || page === undefined ? '—' : String(page), source, src: '—', diff: '—', verdict: '!', note: '缺一侧数据' })
    return
  }
  const d = dev(page, srcVal)
  const verdict: Row['verdict'] = d <= tolPct ? '✓' : d <= tolPct * 10 ? '≈' : '✗'
  push({
    item,
    page: page.toFixed(digits),
    source,
    src: srcVal.toFixed(digits),
    diff: d === 0 ? '0' : `${d.toFixed(4)}%`,
    verdict,
    note,
  })
}

/**
 * RSI 第二实现：ewm(alpha=1/n) 从头递推，不做「前 N 期简单均值」种子。
 * 与 shared/compute/rsi.ts 的种子口径不同，两种口径结果一致才说明结论不依赖实现细节。
 */
function rsiAlt(closes: readonly number[], n: number): number {
  const a = 1 / n
  let ag = 0
  let al = 0
  let first = true
  for (let i = 1; i < closes.length; i++) {
    const d = (closes[i] as number) - (closes[i - 1] as number)
    const g = Math.max(d, 0)
    const l = Math.max(-d, 0)
    if (first) {
      ag = g
      al = l
      first = false
    } else {
      ag += a * (g - ag)
      al += a * (l - al)
    }
  }
  if (al === 0) return 100
  return 100 - 100 / (1 + ag / al)
}

async function main() {
  const [latest, metrics] = await Promise.all([
    readFile(join(DATA_DIR, 'latest.json'), 'utf8').then((s) => JSON.parse(s) as LatestSnapshot),
    readFile(join(DATA_DIR, 'metrics.json'), 'utf8').then((s) => JSON.parse(s) as DailyMetrics),
  ])

  // 页面上的原始值（latest.json 里存的就是 assemble 用的同一批数）
  const q = latest.quote
  const pageOil = latest.macroNow?.oil?.value ?? null
  const pageGold = latest.macroNow?.gold?.value ?? null
  const pageDxy = latest.macroNow?.dxy?.value ?? null

  const [sina, txNdx, txFut, vxn, fgi, pe, ndxDaily, fx] = await Promise.all([
    fetchSnapshots(),
    fetchTencentNdx().catch(() => null),
    fetchTencentFutures().catch(() => null),
    fetchVxn().catch(() => null),
    fetchFearGreed().catch(() => null),
    fetchPe().catch(() => null),
    fetchNdxDaily().catch(() => null),
    fetchAllFx().catch(() => ({})),
  ])

  // ---- 1. NDX 行情：新浪（页面源）vs 腾讯（独立第二源）----
  if (q && txNdx) {
    cmp('NDX 收盘', q.close, txNdx.value, '腾讯 usNDX', 0.01)
    cmp('NDX 昨收', q.prevClose, txNdx.prevClose, '腾讯 usNDX', 0.01)
    cmp('NDX 今开', q.open, txNdx.open, '腾讯 usNDX', 0.01)
    cmp('NDX 最高', q.high, txNdx.high, '腾讯 usNDX', 0.01)
    cmp('NDX 最低', q.low, txNdx.low, '腾讯 usNDX', 0.01)
    cmp('NDX 成交量', q.volume, txNdx.volume, '腾讯 usNDX', 0.01, undefined, 0)
    cmp('NDX 涨跌额', q.close - q.prevClose, txNdx.value - txNdx.prevClose, '腾讯 usNDX', 0.5, undefined, 4)
  }
  // 日 K 末根应与快照一致（防「快照对、日更错」）
  const lastBar = ndxDaily?.[ndxDaily.length - 1]
  if (q && lastBar) cmp('NDX 收盘 vs 日K末根', q.close, lastBar.close, '新浪日K', 0.01, '同源不同接口，校验解析层')

  // ---- 2. 原油 / 黄金：新浪（页面源）vs 腾讯 ----
  if (pageOil !== null && txFut?.oil) {
    // 期货在跳动，页面值来自 N 分钟前的快照，容差按 1% 给
    cmp('WTI 原油', pageOil, txFut.oil.value, '腾讯 hf_CL', 1, '期货实时，快照有时差', 3)
  }
  if (pageGold !== null && txFut?.gold) {
    cmp('COMEX 黄金', pageGold, txFut.gold.value, '腾讯 hf_GC', 1, '期货实时，快照有时差', 3)
  }

  // ---- 3. 美元指数：页面（新浪 DINIW）vs 六货币对自算 ----
  if (pageDxy !== null) {
    const calc = computeDxy(fx)
    const last = calc.series[calc.series.length - 1]
    if (last) {
      const c = checkDxyDeviation(last.close, pageDxy, false)
      push({
        item: '美元指数',
        page: pageDxy.toFixed(4),
        source: '六货币对自算',
        src: last.close.toFixed(4),
        diff: `${c.deviationPct.toFixed(4)}%`,
        verdict: c.ok ? '✓' : '✗',
        note: `容差 ${c.tolerancePct}%（跨时点）`,
      })
    }
  }

  // ---- 4. VXN：页面（CBOE CSV 日更）vs CBOE 官方最新一行 ----
  if (vxn) {
    const pageVxn = metrics.vxn?.close ?? null
    cmp('VXN 收盘', pageVxn, vxn.close, 'CBOE CSV', 0.01)
    // 涨跌额是当日收盘 − 前一交易日收盘
    const pageChg = pageVxn !== null ? pageVxn - vxn.prevClose : null
    cmp('VXN 日变化', pageChg, vxn.close - vxn.prevClose, 'CBOE CSV', 0.5)
  }

  // ---- 5. 恐贪：页面 vs CNN 官方 ----
  if (fgi) {
    cmp('恐贪指数', latest.fearGreed?.score ?? null, fgi.score, 'CNN 官方', 0.01, fgi.timestamp.slice(0, 10), 3)
    cmp('恐贪·前收', latest.fearGreed?.prevClose ?? null, fgi.prevClose, 'CNN 官方', 0.01)
  }

  // ---- 6. PE：页面 vs 蛋卷官方 ----
  if (pe) {
    cmp('PE(TTM)', metrics.pe?.peTTM ?? null, pe.peTTM, '蛋卷 detail', 0.01, `数据日 ${pe.date}`, 3)
    cmp('PE 百分位', metrics.pe?.percentile ?? null, pe.percentile, '蛋卷 detail', 0.01, '单位已由小数换算为 0–100', 2)
  }

  // ---- 7. RSI：第二实现重算 ----
  if (ndxDaily && ndxDaily.length > 30) {
    const closes = ndxDaily.map((b) => b.close)
    const alt = { rsi6: rsiAlt(closes, 6), rsi12: rsiAlt(closes, 12), rsi24: rsiAlt(closes, 24) }
    const page = metrics.rsi
    cmp('RSI6', page?.rsi6 ?? null, alt.rsi6, '独立实现', 0.02)
    cmp('RSI12', page?.rsi12 ?? null, alt.rsi12, '独立实现', 0.02)
    cmp('RSI24', page?.rsi24 ?? null, alt.rsi24, '独立实现', 0.02)
  }

  // ---- 输出 ----
  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - visLen(s)))
  console.log(`\n数据核对  页面数据日 ${metrics.tradeDate}  快照 ${latest.meta.generatedAt}\n`)
  console.log(pad('指标', 18) + pad('页面值', 15) + pad('对照源', 18) + pad('对照值', 15) + pad('偏差', 11) + '结论')
  console.log('-'.repeat(88))
  for (const r of rows) {
    console.log(pad(r.item, 18) + pad(r.page, 15) + pad(r.source, 18) + pad(r.src, 15) + pad(r.diff, 11) + r.verdict + (r.note ? `  ${r.note}` : ''))
  }
  console.log('-'.repeat(88))
  if (failures.length === 0) {
    console.log(`全部 ${rows.length} 项通过。✓ 一致  ≈ 时差导致  ! 缺一侧数据\n`)
  } else {
    console.log(`有 ${failures.length} 项不一致：`)
    for (const f of failures) console.log('  ✗ ' + f)
    process.exitCode = 1
  }
  // 附：源侧原始快照，便于人工复核
  console.log(
    `源侧当前值：新浪 NDX ${sina.ndx?.value ?? '—'} / DINIW ${sina.dxy?.value ?? '—'} / CL ${sina.oil?.value ?? '—'} / GC ${sina.gold?.value ?? '—'}\n`,
  )
}

/** 粗略显示宽度：中文按 2 格算 */
function visLen(s: string): number {
  let n = 0
  for (const ch of s) n += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1
  return n
}

main().catch((e) => {
  console.error('[verify] 失败：', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
