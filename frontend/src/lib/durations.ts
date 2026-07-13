/** One tappable timer found in a step's text, e.g. "smaż 10–12 minut" → 10 min. */
export interface StepDuration {
  /** The matched fragment, used as the chip label ("10–12 min"). */
  label: string
  seconds: number
}

// "10 minut", "10 min", "10–12 min", "1 godzinę", "1,5 godziny", "30 sekund".
// Ranges count down from the lower bound — check the dish early, not late.
const DURATION_RE =
  /(\d+(?:[.,]\d+)?)(?:\s*[–—-]\s*(\d+(?:[.,]\d+)?))?\s*(godzin\p{L}*|godz\.?|minut\p{L}*|min\.?|sekund\p{L}*|sek\.?)(?![\p{L}\d])/giu

function toNumber(s: string): number {
  return Number(s.replace(',', '.'))
}

export function parseStepDurations(text: string): StepDuration[] {
  const found: StepDuration[] = []
  for (const m of text.matchAll(DURATION_RE)) {
    const value = toNumber(m[1])
    const unit = m[3].toLowerCase()
    const perUnit = unit.startsWith('godz') ? 3600 : unit.startsWith('min') ? 60 : 1
    const seconds = Math.round(value * perUnit)
    if (seconds >= 5 && seconds <= 24 * 3600) found.push({ label: m[0].trim(), seconds })
  }
  return found
}

/** "7:05", "1:02:30" — countdown display. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
