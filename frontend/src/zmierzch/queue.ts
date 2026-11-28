import type { Category, Difficulty, Part, Question } from './types'
import type { ProgressMap } from './progress'

export interface Filters {
  /** Empty = all parts. */
  parts: Part[]
  /** 'film' / 'ksiazka' also keep questions tagged 'oba'. */
  source: 'all' | 'film' | 'ksiazka'
  /** Empty = all categories. */
  categories: Category[]
  /** Empty = all difficulties (1, 2, 3). */
  difficulties: Difficulty[]
  /** Only questions already answered wrong and not re-learned (box 0). */
  mistakesOnly: boolean
}

export const DEFAULT_FILTERS: Filters = {
  parts: [],
  source: 'all',
  categories: [],
  difficulties: [],
  mistakesOnly: false,
}

const FILTERS_KEY = 'zmierzch.filters.v1'
const MOVIES_ONLY_KEY = 'zmierzch.moviesOnly.v1'

/** True if the question can be answered from the films alone (excludes book-only and book-vs-film comparisons). */
export function isMovieQuestion(q: Question): boolean {
  if (q.source === 'ksiazka') return false
  if (q.source === 'oba' && q.category === 'roznice') return false
  return true
}

export function loadMoviesOnly(): boolean {
  try {
    return localStorage.getItem(MOVIES_ONLY_KEY) === '1'
  } catch {
    return false
  }
}

export function saveMoviesOnly(on: boolean) {
  try {
    localStorage.setItem(MOVIES_ONLY_KEY, on ? '1' : '0')
  } catch {
    /* convenience only */
  }
}

export function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY)
    const f = raw ? (JSON.parse(raw) as Partial<Filters> & { hardOnly?: boolean }) : {}
    const difficulties: Difficulty[] = Array.isArray(f.difficulties)
      ? f.difficulties.filter((d): d is Difficulty => d === 1 || d === 2 || d === 3)
      : f.hardOnly === true
        ? [3]
        : []
    return {
      parts: Array.isArray(f.parts) ? f.parts : [],
      source: f.source === 'film' || f.source === 'ksiazka' ? f.source : 'all',
      categories: Array.isArray(f.categories) ? f.categories : [],
      difficulties,
      mistakesOnly: f.mistakesOnly === true,
    }
  } catch {
    return DEFAULT_FILTERS
  }
}

export function saveFilters(f: Filters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f))
  } catch {
    /* convenience only */
  }
}

export function applyFilters(all: Question[], f: Filters, progress: ProgressMap, moviesOnly = false): Question[] {
  return all.filter((q) => {
    if (moviesOnly && !isMovieQuestion(q)) return false
    if (f.parts.length && !f.parts.includes(q.part)) return false
    if (!moviesOnly && f.source !== 'all' && q.source !== f.source && q.source !== 'oba') return false
    if (f.categories.length && !f.categories.includes(q.category)) return false
    if (f.difficulties.length && !f.difficulties.includes(q.difficulty)) return false
    if (f.mistakesOnly) {
      const p = progress[q.id]
      if (!p || p.wrong === 0 || p.box > 0) return false
    }
    return true
  })
}

/**
 * Determines which leaderboard scope a standard Quiz run counts toward:
 * - No extra filters & all parts → 'all' (whole suite)
 * - No extra filters & 1 part → 'part:<part>'
 * - Anything else (categories, source, difficulty, mistakes, multi-part) → 'custom' (unranked)
 */
export function resolveQuizScope(f: Filters, moviesOnly = false): string {
  if ((!moviesOnly && f.source !== 'all') || f.categories.length > 0 || f.difficulties.length > 0 || f.mistakesOnly) {
    return 'custom'
  }
  if (f.parts.length === 0) return 'all'
  if (f.parts.length === 1) return `part:${f.parts[0]}`
  return 'custom'
}

export function shuffle<T>(xs: readonly T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Least-known first, with jitter so sessions don't repeat the same order:
 * mistakes (box 0) → unseen → box 1 → … `spread` widens the jitter (quiz mode
 * wants more variety than flashcards).
 */
export function pickSession(pool: Question[], progress: ProgressMap, size: number, spread = 1.2): Question[] {
  const keyed = pool.map((q) => {
    const p = progress[q.id]
    const base = !p || p.seen === 0 ? 0.6 : p.box
    return { q, k: base + Math.random() * spread }
  })
  keyed.sort((a, b) => a.k - b.k)
  return shuffle(keyed.slice(0, size).map((x) => x.q))
}
