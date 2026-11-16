import type { Category, Part, Question } from './types'
import type { ProgressMap } from './progress'

export interface Filters {
  /** Empty = all parts. */
  parts: Part[]
  /** 'film' / 'ksiazka' also keep questions tagged 'oba'. */
  source: 'all' | 'film' | 'ksiazka'
  /** Empty = all categories. */
  categories: Category[]
  hardOnly: boolean
  /** Only questions already answered wrong and not re-learned (box 0). */
  mistakesOnly: boolean
}

export const DEFAULT_FILTERS: Filters = { parts: [], source: 'all', categories: [], hardOnly: false, mistakesOnly: false }

const FILTERS_KEY = 'zmierzch.filters.v1'

export function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY)
    const f = raw ? (JSON.parse(raw) as Partial<Filters>) : {}
    return {
      parts: Array.isArray(f.parts) ? f.parts : [],
      source: f.source === 'film' || f.source === 'ksiazka' ? f.source : 'all',
      categories: Array.isArray(f.categories) ? f.categories : [],
      hardOnly: f.hardOnly === true,
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

export function applyFilters(all: Question[], f: Filters, progress: ProgressMap): Question[] {
  return all.filter((q) => {
    if (f.parts.length && !f.parts.includes(q.part)) return false
    if (f.source !== 'all' && q.source !== f.source && q.source !== 'oba') return false
    if (f.categories.length && !f.categories.includes(q.category)) return false
    if (f.hardOnly && q.difficulty < 3) return false
    if (f.mistakesOnly) {
      const p = progress[q.id]
      if (!p || p.wrong === 0 || p.box > 0) return false
    }
    return true
  })
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
