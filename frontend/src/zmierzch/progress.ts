// Per-device progress (localStorage). Leitner boxes 0–4 rather than day intervals:
// the quiz is days away and they will cram several sessions a day.

import type { Question } from './types'

export interface CardProgress {
  /** 0 = just got it wrong / not learned, 4 = solid. */
  box: number
  seen: number
  wrong: number
  /** Epoch ms of the last answer. */
  last: number
}

export type ProgressMap = Record<string, CardProgress>

export const MAX_BOX = 4
/** A card counts as mastered from this box up. */
export const KNOWN_BOX = 3

const KEY = 'zmierzch.v1'

export function loadProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: ProgressMap = {}
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      const c = v as Partial<CardProgress> | null
      if (c && typeof c.box === 'number' && typeof c.seen === 'number')
        out[id] = { box: c.box, seen: c.seen, wrong: c.wrong ?? 0, last: c.last ?? 0 }
    }
    return out
  } catch {
    return {}
  }
}

export function saveProgress(map: ProgressMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* storage blocked — progress just won't persist */
  }
}

export function grade(map: ProgressMap, id: string, correct: boolean, now = Date.now()): ProgressMap {
  const prev = map[id]
  const box = correct ? Math.min(MAX_BOX, (prev?.box ?? 0) + 1) : 0
  return {
    ...map,
    [id]: { box, seen: (prev?.seen ?? 0) + 1, wrong: (prev?.wrong ?? 0) + (correct ? 0 : 1), last: now },
  }
}

export type CardState = 'new' | 'learning' | 'known'

export function stateOf(p: CardProgress | undefined): CardState {
  if (!p || p.seen === 0) return 'new'
  return p.box >= KNOWN_BOX ? 'known' : 'learning'
}

export interface Counts {
  total: number
  new: number
  learning: number
  known: number
}

export function countStates(questions: Question[], map: ProgressMap): Counts {
  const c: Counts = { total: questions.length, new: 0, learning: 0, known: 0 }
  for (const q of questions) c[stateOf(map[q.id])]++
  return c
}
