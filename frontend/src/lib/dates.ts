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

/** Monday of the date's week (local). */
export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export const WEEKDAY_SHORT = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd']

/** "14.09" */
export function dayMonth(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

/** "14 paź" — the design's day label next to serif day names. */
export function dayShortMonth(d: Date): string {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

/** "17:10" — local clock time of an ISO instant. */
export function hhmm(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** When a sync happened: „12:40”, „wczoraj 21:10” or „10 paź 08:00”. */
export function syncLabel(iso: string): string {
  const d = new Date(iso)
  const days = daysAgo(toISO(d))
  return days === 0 ? hhmm(iso) : days === 1 ? `wczoraj ${hhmm(iso)}` : `${dayShortMonth(d)} ${hhmm(iso)}`
}
