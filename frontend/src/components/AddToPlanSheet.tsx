import { useEffect, useMemo, useState } from 'react'
import { usePlan, useSetPlanEntry } from '../api/hooks'
import type { Slot } from '../api/client'
import { SLOTS, slotLabel } from '../lib/labels'
import { WEEKDAY_SHORT, addDays, dayMonth, mondayOf, toISO } from '../lib/dates'
import { showToast } from '../lib/toastBus'
import { Button, Chip, Eyebrow, Sheet, mono, sans } from './ui'

/** "Dodaj do planu": pick a day of this/next week and a slot, then save a plan entry for the recipe. */
export function AddToPlanSheet({ open, onClose, recipe }: {
  open: boolean
  onClose: () => void
  recipe: { id: string; title: string }
}) {
  const today = useMemo(() => new Date(), [])
  const [weekOffset, setWeekOffset] = useState(0)
  const weekStart = addDays(mondayOf(today), weekOffset * 7)
  const startISO = toISO(weekStart)
  const { data: plan } = usePlan(startISO)
  const set = useSetPlanEntry()
  const [date, setDate] = useState(toISO(today))
  const [slot, setSlot] = useState<Slot>('lunch')

  useEffect(() => {
    if (open) {
      setWeekOffset(0)
      setDate(toISO(today))
      setSlot('lunch')
    }
  }, [open, today])

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const taken = plan?.entries.find((e) => e.date === date && e.slot === slot)

  async function save() {
    await set.mutateAsync({ date, slot, recipeId: recipe.id })
    showToast(`Dodano do planu: ${recipe.title}`)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Dodaj do planu">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <span style={{ fontFamily: 'var(--serif)', fontSize: 20, lineHeight: 1.2 }}>{recipe.title}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Eyebrow>Dzień</Eyebrow>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: sans(13, 600) }}>
              <button type="button" onClick={() => setWeekOffset((w) => Math.max(0, w - 1))} disabled={weekOffset === 0} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 16, opacity: weekOffset === 0 ? 0.3 : 1 }}>‹</button>
              {dayMonth(days[0])} – {dayMonth(days[6])}
              <button type="button" onClick={() => setWeekOffset((w) => w + 1)} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 16 }}>›</button>
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {days.map((d, i) => {
              const iso = toISO(d)
              const past = iso < toISO(today)
              const on = iso === date
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={past}
                  onClick={() => setDate(iso)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2,
                    padding: '8px 0',
                    borderRadius: 10,
                    border: on ? 0 : '1px solid var(--border)',
                    background: on ? 'var(--text)' : 'transparent',
                    color: on ? 'var(--bg)' : 'var(--text)',
                    cursor: past ? 'default' : 'pointer',
                    opacity: past ? 0.35 : 1,
                  }}
                >
                  <span style={{ font: mono(10.5, 500), opacity: 0.75 }}>{WEEKDAY_SHORT[i].toUpperCase()}</span>
                  <span style={{ font: mono(15, 500) }}>{d.getDate()}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow>Posiłek</Eyebrow>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SLOTS.map((s) => <Chip key={s} active={slot === s} onClick={() => setSlot(s)}>{slotLabel[s]}</Chip>)}
          </div>
        </div>
        {taken && (
          <span style={{ font: sans(13.5), color: 'var(--accent-text)' }}>
            Zastąpi: {taken.recipeTitle ?? taken.title}
          </span>
        )}
        <Button size="xl" onClick={save} disabled={set.isPending}>
          {set.isPending ? 'Zapisywanie…' : taken ? 'Zastąp w planie' : 'Dodaj do planu'}
        </Button>
      </div>
    </Sheet>
  )
}
