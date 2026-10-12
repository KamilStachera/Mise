import { useEffect, useState } from 'react'
import type { RecipeListItem, Slot } from '../../api/client'
import { useAddDiaryEntry } from '../../api/hooks'
import { DIARY_SLOTS, slotLabel, slotTo } from '../../lib/labels'
import { showToast } from '../../lib/toastBus'
import { Button, Segmented, Sheet, inputStyle } from '../ui'
import { RecipePicker } from './RecipePicker'

/**
 * „Zaplanuj posiłek” for a day that hasn't happened yet: a saved recipe or a typed dish.
 * A recipe can go on to „Gotuję na kilka dni” instead of a single entry.
 */
export function PlanMealSheet({ open, onClose, date, initialSlot, onSplit }: {
  open: boolean
  onClose: () => void
  date: string
  initialSlot: Slot
  onSplit: (recipe: RecipeListItem, date: string, slot: Slot) => void
}) {
  const add = useAddDiaryEntry()
  const [slot, setSlot] = useState<Slot>(initialSlot)
  const [mode, setMode] = useState<'recipe' | 'text'>('recipe')
  const [recipe, setRecipe] = useState<RecipeListItem | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    setSlot(initialSlot)
    setMode('recipe')
    setRecipe(null)
    setTitle('')
    setNote('')
  }, [open, initialSlot])

  const canSave = mode === 'recipe' ? !!recipe : title.trim().length > 0

  async function save() {
    await add.mutateAsync({
      date,
      slot,
      recipeId: mode === 'recipe' ? recipe!.id : null,
      title: mode === 'text' ? title.trim() : undefined,
      note: note.trim(),
    })
    showToast(`Zaplanowano ${slotTo[slot]}: ${mode === 'recipe' ? recipe!.title : title.trim()}`)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Zaplanuj posiłek" width={540}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Segmented value={slot} onChange={setSlot} items={DIARY_SLOTS.map((s) => ({ key: s, label: slotLabel[s] }))} />
        <Segmented
          value={mode}
          onChange={setMode}
          items={[{ key: 'recipe', label: 'Zapisany przepis' }, { key: 'text', label: 'Własne danie' }]}
        />
        {mode === 'recipe' ? (
          <RecipePicker selected={recipe} onSelect={setRecipe} />
        ) : (
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="np. Pizza na mieście…" autoFocus />
        )}
        <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notatka (opcjonalnie)…" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button size="xl" style={{ flex: 1 }} disabled={!canSave || add.isPending} onClick={save}>
            {add.isPending ? 'Zapisywanie…' : `Zaplanuj ${slotTo[slot]}`}
          </Button>
          {mode === 'recipe' && recipe && slot !== 'snack' && (
            <Button size="xl" variant="outline" onClick={() => onSplit(recipe, date, slot)}>Na kilka dni…</Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
