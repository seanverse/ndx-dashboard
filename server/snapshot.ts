/**
 * 按日快照：组装 + 落盘。
 *
 * 为什么剥离 macroSeries / vxn.series：那是上游自带的长序列，每天重复同一段历史。
 * 按日全量存，一年 8 MB 里九成是同一条数据的第 N 份副本，且日后要看「某天发生了什么」
 * 还得在副本里挑一遍。只留当日派生值与不可重算的事实，一天约 0.6 KB。
 *
 * 哪些属于「不可重算」：PE 分位（蛋卷只给当期）、dxyCheck（当时的校验结论）、
 * failedSources（当时哪个源坏了）。这些丢了就永远补不回来。RSI / HV20 虽然能从上游
 * 日 K 重算，但重算出来的是「今天算的」而不是「当时算的」，一并留。
 */

import type {
  DailyMetrics,
  DailySnapshot,
  DailyVerdict,
  DashboardResponse,
  LatestSnapshot,
} from '../shared/types'
import { assembleDashboard } from './assemble'
import { dailyPath, readAt, readJson, writeAt } from './store'

/** 日期分片写一次就不再变，缓存一年 */
const SNAPSHOT_CACHE_MAX_AGE = 365 * 24 * 3600

export type SnapshotStatus = 'written' | 'exists' | 'patched' | 'failed'

/**
 * 组装一份日快照。
 *
 * @param view 用当日 metrics + latest 装配出的完整看板；为 null 表示手上没有可用的
 *             收盘截面（当天 collect 全失败），此时 verdict 记 null 而不是留空对象。
 */
export function buildDailySnapshot(
  metrics: DailyMetrics,
  view: DashboardResponse | null,
): DailySnapshot {
  return {
    tradeDate: metrics.tradeDate,
    generatedAt: metrics.generatedAt,
    rsi: metrics.rsi,
    hv20: metrics.hv20,
    vxn: {
      close: metrics.vxn.close,
      prevClose: metrics.vxn.prevClose,
      change: metrics.vxn.change,
      changePct: metrics.vxn.changePct,
      ma20: metrics.vxn.ma20,
    },
    pe: metrics.pe,
    macroStats: metrics.macroStats,
    dxyCheck: metrics.dxyCheck,
    failedSources: metrics.failedSources,
    verdict: pickVerdict(metrics, view),
  }
}

/**
 * 取当日结论。三道闸门，任何一道不过就记 null：
 *
 * 1 交易日必须一致 —— latest 落后一天时，它算出的结论属于前一天，记进来历史会说假话
 * 2 不能是 stale —— 抓取失败时 quote 沿用上一版，用那个价算出来的档位没有意义
 * 3 必须已收盘 —— `post`（16:00–20:00 ET）与 `closed` 都算，`open` / `pre` 不算。
 *   注意 Vercel Cron 定在 22:00 UTC，夏令时对应 18:00 ET、冬令时 17:00 ET，都落在 `post`，
 *   所以这里不能只认 `closed`，否则正常日更永远拿不到结论。
 *
 * 原则是「宁可缺，不可错」：缺一条 verdict 只是复盘时少一天，错一条会污染整条时间线。
 */
function pickVerdict(metrics: DailyMetrics, view: DashboardResponse | null): DailyVerdict | null {
  if (!view) return null
  if (view.meta.tradeDate !== metrics.tradeDate) return null
  if (view.meta.stale) return null
  if (view.meta.phase !== 'post' && view.meta.phase !== 'closed') return null

  const { score, advice } = view
  if (!score || !advice) return null

  return {
    model: score.model,
    health: score.health,
    stars: score.stars,
    riskLevel: score.riskLevel,
    ruleId: advice.ruleId,
    position: advice.position,
  }
}

/**
 * 落一份日快照。
 *
 * 三种结局，区别在于「已存在的分片能不能改」：
 *   written —— 首次写入
 *   exists  —— 已有定稿（含 verdict），或这次也拿不到结论，原样保留
 *   patched —— 已有的分片缺 verdict，这次算出来了，只补 verdict，指标不动
 *
 * 为什么允许补 verdict 却不允许改指标：分片一旦写成就是历史，上游事后修订
 * 不该改写已经发布的那一天；但「有指标、没结论」是半个残页，补上结论只是补齐，
 * 不构成改写。这条规则让「盘中误触发写了一份无结论快照」也能在当晚自动闭环。
 */
export async function writeDailySnapshot(
  metrics: DailyMetrics,
  now: Date = new Date(),
): Promise<SnapshotStatus> {
  const rel = dailyPath(metrics.tradeDate)
  const existing = await readAt<DailySnapshot>(rel)

  if (existing !== null) {
    if (existing.verdict !== null) return 'exists'
    const verdict = pickVerdict(metrics, await loadView(metrics, now))
    if (verdict === null) return 'exists'
    await writeAt(rel, { ...existing, verdict }, { cacheControlMaxAge: SNAPSHOT_CACHE_MAX_AGE })
    return 'patched'
  }

  const view = await loadView(metrics, now)
  await writeAt(rel, buildDailySnapshot(metrics, view), {
    cacheControlMaxAge: SNAPSHOT_CACHE_MAX_AGE,
  })
  return 'written'
}

/** 用当日 metrics + 最新截面装配完整看板；latest 缺失时返回 null，快照照写、结论留空 */
async function loadView(metrics: DailyMetrics, now: Date): Promise<DashboardResponse | null> {
  const latest = await readJson<LatestSnapshot>('latest')
  return latest ? assembleDashboard(latest, metrics, { now }) : null
}

/** 快照失败不影响主流程：metrics 已落盘，下一次触发会自动补 */
export async function tryWriteDailySnapshot(
  metrics: DailyMetrics,
  now: Date = new Date(),
): Promise<SnapshotStatus> {
  try {
    return await writeDailySnapshot(metrics, now)
  } catch (e) {
    console.error('[snapshot] write failed', String(e).slice(0, 200))
    return 'failed'
  }
}
