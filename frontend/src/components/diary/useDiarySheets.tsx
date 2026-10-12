import { useState } from 'react'
import type { PlanEntry, Slot } from '../../api/client'
import { useRecipes } from '../../api/hooks'
import { toISO } from '../../lib/dates'
import { CookSplitSheet, type CookOrigin } from './CookSplitSheet'
import { EntrySheet } from './EntrySheet'
import { PlanMealSheet } from './PlanMealSheet'
import { QuickAddSheet } from './QuickAddSheet'

type SplitState = { recipe?: { id: string; title: string; kcal: number | null; servings?: number }; origin: CookOrigin }

/**
 * One place that owns the calendar's sheets, so Dzień and Tydzień behave the same:
 * adding to today or the past logs food (Szybki wpis), adding to a future day plans a meal.
 */
export function useDiarySheets() {
  const { data: recipes } = useRecipes('all', '')
  const [add, setAdd] = useState<{ date: string; slot: Slot; mode: 'log' | 'plan' } | null>(null)
  const [entry, setEntry] = useState<PlanEntry | null>(null)
  const [split, setSplit] = useState<SplitState | null>(null)

  const recipeInfo = (id: string | null) => {
    const r = recipes?.find((x) => x.id === id)
    return r ? { id: r.id, title: r.title, kcal: r.kcal, servings: r.servings } : undefined
  }

  const openAdd = (date: string, slot: Slot) =>
    setAdd({ date, slot, mode: date > toISO(new Date()) ? 'plan' : 'log' })

  const sheets = (
    <>
      <QuickAddSheet open={add?.mode === 'log'} onClose={() => setAdd(null)} date={add?.date ?? ''} initialSlot={add?.slot ?? 'snack'} />
      <PlanMealSheet
        open={add?.mode === 'plan'}
        onClose={() => setAdd(null)}
        date={add?.date ?? ''}
        initialSlot={add?.slot ?? 'lunch'}
        onSplit={(r, date, slot) => {
          setAdd(null)
          setSplit({ recipe: { id: r.id, title: r.title, kcal: r.kcal, servings: r.servings }, origin: { kind: 'new', date, slot } })
        }}
      />
      <EntrySheet
        entry={entry}
        onClose={() => setEntry(null)}
        onSplit={(e) => {
          setEntry(null)
          setSplit({ recipe: recipeInfo(e.recipeId) ?? { id: e.recipeId!, title: e.recipeTitle ?? e.title, kcal: null }, origin: { kind: 'entry', entry: e } })
        }}
        onEditCook={(cookId) => {
          setEntry(null)
          setSplit({ origin: { kind: 'edit', cookId } })
        }}
      />
      {split && <CookSplitSheet open onClose={() => setSplit(null)} recipe={split.recipe} origin={split.origin} />}
    </>
  )

  return { openAdd, openEntry: setEntry, sheets }
}
