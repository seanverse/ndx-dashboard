/**
 * RSI：Wilder 平滑，等价通达信 SMA(X,N,1)，与 TradingView 默认口径一致。
 * PRD-001 §3.5。
 *
 *   α = 1/N
 *   avgGain_t = α·max(Δ,0) + (1−α)·avgGain_{t−1}
 *   avgLoss_t = α·max(−Δ,0) + (1−α)·avgLoss_{t−1}
 *   RSI_N = 100 − 100 / (1 + avgGain / avgLoss)
 *
 * 种子值取前 N 期变化的简单均值。序列不足 N+1 个点时返回 null（缺数不得按 0 处理）。
 */
export function rsi(closes: readonly number[], n: number): number | null {
  if (n <= 0 || closes.length < n + 1) return null

  let gainSum = 0
  let lossSum = 0
  let prev = closes[0] as number
  for (let i = 1; i <= n; i++) {
    const cur = closes[i] as number
    const d = cur - prev
    if (d > 0) gainSum += d
    else lossSum -= d
    prev = cur
  }

  let avgGain = gainSum / n
  let avgLoss = lossSum / n
  const alpha = 1 / n

  for (let i = n + 1; i < closes.length; i++) {
    const cur = closes[i] as number
    const d = cur - prev
    avgGain = alpha * Math.max(d, 0) + (1 - alpha) * avgGain
    avgLoss = alpha * Math.max(-d, 0) + (1 - alpha) * avgLoss
    prev = cur
  }

  // 全涨无跌时 RSI 定义为 100（避免除零得到 Infinity）
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

/** 返回 6/12/24 三周期，任一缺失不影响其余 */
export function rsiTriple(closes: readonly number[]): {
  rsi6: number | null
  rsi12: number | null
  rsi24: number | null
} {
  return {
    rsi6: rsi(closes, 6),
    rsi12: rsi(closes, 12),
    rsi24: rsi(closes, 24),
  }
}
