/**
 * 美东交易日历与时段判定。
 *
 * 两条硬规则（TECH-001 §2.2）：
 *   1. 非交易时段跳过抓取，避免用空数据覆盖好缓存
 *   2. 写入前校验新数据交易日期 ≥ 旧数据
 *
 * 为什么不用 cron 表达式做时段判断：cron 是 UTC，把 ET 时间写死会在每年两次夏令时切换时失效。
 * 所有时间判断集中在本文件，用 Intl 按 America/New_York 取当地时分。
 */

const TZ = 'America/New_York'

/** 全天休市。2025–2027 已核实；超出范围时退化为「只按周末判断」并给出 warning。 */
const HOLIDAYS: Record<string, string> = {
  // 2025
  '2025-01-01': "New Year's Day",
  '2025-01-20': 'MLK Day',
  '2025-02-17': "Presidents' Day",
  '2025-04-18': 'Good Friday',
  '2025-05-26': 'Memorial Day',
  '2025-06-19': 'Juneteenth',
  '2025-07-04': 'Independence Day',
  '2025-09-01': 'Labor Day',
  '2025-11-27': 'Thanksgiving',
  '2025-12-25': 'Christmas',
  // 2026
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'MLK Day',
  '2026-02-16': "Presidents' Day",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving',
  '2026-12-25': 'Christmas',
  // 2027
  '2027-01-01': "New Year's Day",
  '2027-01-18': 'MLK Day',
  '2027-02-15': "Presidents' Day",
  '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving',
  '2027-12-24': 'Christmas (observed)',
}

/** 提前至 13:00 收盘的半日市 */
const EARLY_CLOSES = new Set(['2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24', '2027-11-26'])

export interface EtParts {
  /** YYYY-MM-DD，美东当地日期 */
  iso: string
  hour: number
  minute: number
  /** 0=周日 … 6=周六 */
  dow: number
}

const WEEKDAY_TO_DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function etParts(at: Date = new Date()): EtParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  })
  const parts = fmt.formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const y = get('year')
  const mo = get('month')
  const d = get('day')
  const hour = Number(get('hour'))
  return {
    iso: `${y}-${mo}-${d}`,
    // 部分运行时在午夜返回 "24"
    hour: hour === 24 ? 0 : hour,
    minute: Number(get('minute')),
    dow: WEEKDAY_TO_DOW[get('weekday')] ?? 0,
  }
}

export function isHoliday(iso: string): boolean {
  return iso in HOLIDAYS
}

/** 日历覆盖范围。超出即无法判断假日，需在 meta.warnings 提示。 */
export function calendarCovers(iso: string): boolean {
  return iso >= '2025-01-01' && iso <= '2027-12-31'
}

export function isTradingDay(iso: string): boolean {
  const dow = dayOfWeek(iso)
  if (dow === 0 || dow === 6) return false
  return !isHoliday(iso)
}

/** 由 ISO 日期串求星期，避免时区偏移 */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y as number, (m as number) - 1, d as number)).getUTCDay()
}

/**
 * 盘中采集窗口：常规日 09:30–16:20，半日市 09:30–13:20。
 * 末尾多留 20 分钟是为了让 16:00 那一次触发能抓到收盘价（TECH-001 §5.1 边界 1）。
 */
export function isTradingWindow(at: Date = new Date()): boolean {
  const p = etParts(at)
  if (p.dow === 0 || p.dow === 6) return false
  if (isHoliday(p.iso)) return false
  const minutes = p.hour * 60 + p.minute
  const closeMinute = EARLY_CLOSES.has(p.iso) ? 13 * 60 + 20 : 16 * 60 + 20
  return minutes >= 9 * 60 + 30 && minutes <= closeMinute
}

export type Phase = 'pre' | 'open' | 'post' | 'closed'

/**
 * 盘前从 04:00 ET 起算。此前（00:00–04:00）交易所未开盘、也没有盘前报价，
 * 只能算 closed —— 否则周日夜里到周一凌晨会被显示成「盘前」，与事实不符。
 */
const PRE_OPEN_MINUTE = 4 * 60

export function tradingPhase(at: Date = new Date()): Phase {
  const p = etParts(at)
  if (p.dow === 0 || p.dow === 6 || isHoliday(p.iso)) return 'closed'
  const minutes = p.hour * 60 + p.minute
  if (minutes < PRE_OPEN_MINUTE) return 'closed'
  if (minutes < 9 * 60 + 30) return 'pre'
  if (minutes < 16 * 60) return 'open'
  if (minutes < 20 * 60) return 'post'
  return 'closed'
}

/**
 * 某交易日的收盘时刻（UTC）。用 ET 分量自我校准，不查 DST 表：
 * 先假设 UTC−4（EDT），看换算回 ET 是不是目标小时，不对就用 UTC−5（EST）。
 */
export function closeMomentUtc(tradeDate: string, at: Date = new Date()): Date {
  const [y, m, d] = tradeDate.split('-').map(Number)
  const early = EARLY_CLOSES.has(tradeDate)
  const etHour = early ? 13 : 16
  const etMinute = early ? 0 : 0
  void at
  for (const off of [4, 5]) {
    const t = new Date(Date.UTC(y as number, (m as number) - 1, d as number, etHour + off, etMinute))
    const p = etParts(t)
    if (p.hour === etHour && p.minute === etMinute) return t
  }
  return new Date(Date.UTC(y as number, (m as number) - 1, d as number, etHour + 5, etMinute))
}

/** 当天的美东日期。若当天非交易日，回溯到最近一个交易日。 */
export function etTradeDate(at: Date = new Date()): string {
  let iso = etParts(at).iso
  for (let i = 0; i < 10; i++) {
    if (isTradingDay(iso)) return iso
    iso = shiftIso(iso, -1)
  }
  return iso
}

/** 上一个交易日（不含当天） */
export function prevTradeDate(iso: string): string {
  let cur = shiftIso(iso, -1)
  for (let i = 0; i < 10; i++) {
    if (isTradingDay(cur)) return cur
    cur = shiftIso(cur, -1)
  }
  return cur
}

export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = Date.UTC(y as number, (m as number) - 1, d as number) + days * 86_400_000
  const dt = new Date(t)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
