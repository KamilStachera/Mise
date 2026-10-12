import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PlanEntry, Slot } from '../../api/client'
import { useDeletePlanEntry, usePatchPlanEntry } from '../../api/hooks'
import { WEEKDAY_SHORT, parseISODate } from '../../lib/dates'
import { DIARY_SLOTS, formatKcal, formatPortion, slotLabel } from '../../lib/labels'
import { Button, Eyebrow, Segmented, Sheet, inputStyle, mono, sans } from '../ui'
import { entryTitle, leftoverLabel } from './parts'
import { PortionChip } from './RecipePicker'

const PORTIONS = [0.5, 1, 1.5, 2]

/**
 * Tap on a diary/plan item: planned ↔ eaten, portion size (recipes) or kcal (typed food),
 * move to another slot, pot actions, delete. Chip changes save immediately.
 */
export function EntrySheet({ entry, onClose, onSplit, onEditCook }: {
  entry: PlanEntry | null
  onClose: () => void
  /** Turn this planned recipe into a pot spread over several days. */
  onSplit: (e: PlanEntry) => void
  onEditCook: (cookId: string) => void
}) {
  const nav = useNavigate()
  const patch = usePatchPlanEntry()
  const del = useDeletePlanEntry()
  const [current, setCurrent] = useState<PlanEntry | null>(entry)
  const [kcal, setKcal] = useState('')

  useEffect(() => {
    setCurrent(entry)
    setKcal(entry?.kcal != null ? String(entry.kcal) : '')
  }, [entry])

  if (!current) return null

  const e = current
  const isRecipe = e.recipeId != null
  const cookDay = e.cookId != null && !e.isLeftover
  const d = parseISODate(e.date)

  async function apply(p: Parameters<typeof patch.mutateAsync>[0]['patch']) {
    setCurrent(await patch.mutateAsync({ id: e.id, patch: p }))
  }

  async function onDelete() {
    if (cookDay && !confirm('Usunąć gotowanie razem z zaplanowanymi resztkami?')) return
    await del.mutateAsync(e.id)
    onClose()
  }

  const kcalValue = Number(kcal.replace(',', '.'))
  const kcalDirty = !isRecipe && kcal.trim() !== '' && Number.isFinite(kcalValue) && Math.round(kcalValue) !== e.kcal

  return (
    <Sheet open onClose={onClose} title={entryTitle(e)} width={500}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ font: sans(14), color: 'var(--text-2)', marginTop: -6 }}>
          {WEEKDAY_SHORT[(d.getDay() + 6) % 7]} {d.getDate()} · {slotLabel[e.slot]}
          {e.cookId && <> · <i style={{ fontFamily: 'var(--serif)' }}>{e.isLeftover ? leftoverLabel(e) : `gotuję ×${e.cookPortions}`}</i></>}
        </span>

        <Segmented
          value={e.eaten ? 'eaten' : 'planned'}
          onChange={(k) => apply({ eaten: k === 'eaten' })}
          items={[{ key: 'planned', label: 'W planie' }, { key: 'eaten', label: '✓ Zjedzone' }]}
        />

        {isRecipe ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Eyebrow>Porcja</Eyebrow>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PORTIONS.map((p) => (
                <PortionChip key={p} on={e.portions === p} onClick={() => apply({ portions: p })}>{formatPortion(p)}</PortionChip>
              ))}
            </div>
            <span style={{ font: mono(13), color: 'var(--text-2)' }}>
              {e.kcalMissing ? 'Przepis nie ma jeszcze kcal.' : `${e.eaten ? '' : '~'}${formatKcal(e.kcal ?? 0)} kcal${e.protein != null ? ` · B ${Math.round(e.protein)} g` : ''}`}
            </span>
          </div>
        ) : (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Eyebrow>kcal{e.grams != null ? ` · ${String(e.grams).replace('.', ',')} g` : ''}</Eyebrow>
            <span style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...inputStyle, font: mono(16) }} value={kcal} onChange={(ev) => setKcal(ev.target.value)} inputMode="numeric" placeholder="brak kcal" />
              {kcalDirty && <Button onClick={() => apply({ kcal: Math.round(kcalValue) })}>Zapisz</Button>}
            </span>
          </label>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Eyebrow>Posiłek</Eyebrow>
          <Segmented value={e.slot} onChange={(s: Slot) => apply({ slot: s })} items={DIARY_SLOTS.map((s) => ({ key: s, label: slotLabel[s] }))} />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
          {isRecipe && !e.cookId && !e.eaten && (
            <Button variant="outline" onClick={() => onSplit(e)}>Gotuję na kilka dni</Button>
          )}
          {cookDay && <Button variant="outline" onClick={() => onEditCook(e.cookId!)}>Porcje i resztki</Button>}
          {isRecipe && <Button variant="quiet" onClick={() => nav(`/recipe/${e.recipeId}`)}>Otwórz przepis</Button>}
          <span style={{ flex: 1 }} />
          <Button variant="text" style={{ color: 'var(--accent-text)' }} onClick={onDelete} disabled={del.isPending}>
            {cookDay ? 'Usuń gotowanie' : 'Usuń'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
