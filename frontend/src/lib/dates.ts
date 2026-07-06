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
