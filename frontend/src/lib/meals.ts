import { useMemo } from 'react'
import type { MealSlot, Slot } from '../api/client'
import { useMeals } from '../api/hooks'

/** What GET /meals returns for someone who never edited their day (backend `MealSlots.Defaults`). */
export const DEFAULT_MEALS: MealSlot[] = [
  { key: 'breakfast', name: 'Śniadanie', snack: false, active: true },
  { key: 'lunch', name: 'Obiad', snack: false, active: true },
  { key: 'dinner', name: 'Kolacja', snack: false, active: true },
  { key: 'snack', name: 'Przekąski', snack: true, active: true },
]

export interface DayMeals {
  /** Active meals in day order — the rows of the diary day. */
  all: MealSlot[]
  /** Active meals you plan and cook (no snack meals). */
  planned: MealSlot[]
  /** Name of any key, removed meals included; the key itself when unknown. */
  label: (key: Slot) => string
  isSnack: (key: Slot) => boolean
  /** Where „Szybki wpis” lands by default: the first snack meal, else the last meal. */
  snackKey: Slot
  /** Default for planning a dish: Obiad if the person has it, else the middle planned meal. */
  mainKey: Slot
  /** Sensible meal for "now" — a fridge portion eaten at 13:00 goes to the midday meal. */
  forNow: (d?: Date) => Slot
}

/**
 * The acting person's day. Planned meals split the day evenly between 11:00 and 17:00
 * (three meals → before 11 / before 17 / after, as before custom meals existed).
 */
export function dayMeals(list: MealSlot[]): DayMeals {
  const all = list.filter((m) => m.active)
  const planned = all.filter((m) => !m.snack)
  const byKey = new Map(list.map((m) => [m.key, m]))
  const fallback = planned[Math.floor((planned.length - 1) / 2)] ?? all[0]
  return {
    all,
    planned,
    label: (key) => byKey.get(key)?.name ?? DEFAULT_MEALS.find((m) => m.key === key)?.name ?? key,
    isSnack: (key) => byKey.get(key)?.snack ?? false,
    snackKey: (all.find((m) => m.snack) ?? all[all.length - 1])?.key ?? 'snack',
    mainKey: (planned.find((m) => m.key === 'lunch') ?? fallback)?.key ?? 'lunch',
    forNow: (d = new Date()) => {
      if (planned.length === 0) return all[0]?.key ?? 'lunch'
      const h = d.getHours() + d.getMinutes() / 60
      const n = planned.length
      // Boundaries between meals: one at 14 for two meals, else spread 11 → 17.
      const bounds = n === 1 ? [] : n === 2 ? [14] : Array.from({ length: n - 1 }, (_, i) => 11 + (6 * i) / (n - 2))
      const idx = bounds.findIndex((b) => h < b)
      return planned[idx === -1 ? n - 1 : idx].key
    },
  }
}

/** {@link dayMeals} for the acting person; the defaults until GET /meals answers. */
export function useDayMeals(): DayMeals {
  const { data } = useMeals()
  return useMemo(() => dayMeals(data ?? DEFAULT_MEALS), [data])
}
