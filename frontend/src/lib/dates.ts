// Local-time date helpers. `new Date('YYYY-MM-DD')` parses as UTC midnight,
// which shifts the calendar day west of Greenwich — always parse manually.

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Whole calendar days between the date and today (0 = today, negative = future). */
export function daysAgo(iso: string, now = new Date()): number {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((startOfToday.getTime() - parseISODate(iso).getTime()) / 86_400_000)
}

/** Local calendar date as YYYY-MM-DD (toISOString would use UTC). */
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayIso(): string {
  return toISO(new Date())
}
