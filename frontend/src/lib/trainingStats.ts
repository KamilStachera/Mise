// Pure helpers for the live workout tracker, PR calculations, and wall-clock rest timer.
// Kept dependency-free so Node unit tests (`frontend/tests/unit.mjs`) import this file directly.

export interface PrBaselineLike {
  bestWeightKg: number | null
  bestWeightReps: number | null
  bestEst1RmKg: number | null
  bestBodyweightReps: number | null
  bestSeconds: number | null
}

export interface SetLike {
  weightKg: number | null
  reps: number | null
  seconds: number | null
  completed: boolean
}

/** Epley estimated 1RM (rounded to 2 decimal places). Returns 0 when weight or reps are non-positive. */
export function estimated1Rm(weightKg: number | null | undefined, reps: number | null | undefined): number {
  if (weightKg == null || weightKg <= 0 || reps == null || reps <= 0) return 0
  if (reps === 1) return Math.round(weightKg * 100) / 100
  return Math.round(weightKg * (1 + reps / 30) * 100) / 100
}

/** Total lifted volume (kg) across completed weighted sets. */
export function totalVolumeKg(sets: readonly SetLike[]): number {
  let sum = 0
  for (const s of sets) {
    if (s.completed && s.weightKg != null && s.weightKg > 0 && s.reps != null && s.reps > 0) {
      sum += s.weightKg * s.reps
    }
  }
  return Math.round(sum * 100) / 100
}

/**
 * Live PR preview during a workout: returns the PR kind if this completed set strictly beats the
 * person's prior baseline from earlier finished sessions, otherwise null.
 */
export function liveSetPrKind(
  set: SetLike,
  baseline: PrBaselineLike | null | undefined,
  isTimed: boolean,
): 'weight' | 'est-1rm' | 'reps' | 'seconds' | null {
  if (!set.completed || !baseline) return null
  if (isTimed || (set.seconds != null && set.seconds > 0 && set.reps == null)) {
    if (set.seconds != null && set.seconds > (baseline.bestSeconds ?? 0)) return 'seconds'
    return null
  }
  if (set.weightKg != null && set.weightKg > 0 && set.reps != null && set.reps > 0) {
    if (set.weightKg > (baseline.bestWeightKg ?? 0)) return 'weight'
    const e1rm = estimated1Rm(set.weightKg, set.reps)
    if (baseline.bestEst1RmKg != null && e1rm > baseline.bestEst1RmKg) return 'est-1rm'
    return null
  }
  if (baseline.bestWeightKg == null && set.reps != null && set.reps > (baseline.bestBodyweightReps ?? 0)) {
    return 'reps'
  }
  return null
}

/** Remaining whole seconds until a wall-clock deadline (0 when expired). Prevents background tab drift. */
export function remainingTimerSeconds(endsAtMs: number | null | undefined, nowMs: number): number {
  if (endsAtMs == null) return 0
  const diff = endsAtMs - nowMs
  if (diff <= 0) return 0
  return Math.ceil(diff / 1000)
}

/** Format seconds as mm:ss (e.g. 75 -> "01:15", 3665 -> "61:05"). */
export function formatTimerClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
}

/** Format weight in Polish style: 40 -> "40", 42.5 -> "42,5". */
export function formatKg(kg: number | null | undefined): string {
  if (kg == null) return ''
  const rounded = Math.round(kg * 100) / 100
  return String(rounded).replace('.', ',')
}

/** Parse a Polish/standard decimal weight string ("42,5" or "42.5"). Returns null when blank/invalid. */
export function parseKg(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0 || n > 1000) return null
  return Math.round(n * 100) / 100
}

/** Format total volume cleanly in Polish: 1850 -> "1 850 kg", 425.5 -> "425,5 kg". */
export function formatVolume(kg: number): string {
  const rounded = Math.round(kg * 10) / 10
  const [whole, frac] = String(rounded).split('.')
  const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
  return frac ? `${spaced},${frac} kg` : `${spaced} kg`
}

/** Polish plural for "seria": 1 seria, 2–4 serie, 5+ serii. */
export function pluralSets(n: number): string {
  if (n === 1) return '1 seria'
  const last = n % 10
  const lastTwo = n % 100
  return `${n} ${last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'serie' : 'serii'}`
}

/** Polish plural for "rekord": 1 nowy rekord, 2–4 nowe rekordy, 5+ nowych rekordów. */
export function pluralPrs(n: number): string {
  if (n === 1) return '1 nowy rekord'
  const last = n % 10
  const lastTwo = n % 100
  return `${n} ${last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'nowe rekordy' : 'nowych rekordów'}`
}
