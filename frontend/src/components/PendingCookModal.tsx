import { useMemo, useState } from 'react'
import { useAddCookLog, useAuth, useDismissCookReminder, usePendingCook } from '../api/hooks'
import type { PlanEntry } from '../api/client'
import { showToast } from '../lib/toastBus'
import { plural, slotLabel } from '../lib/labels'
import { parseISODate } from '../lib/dates'
import { Button, Eyebrow, Sheet, mono, sans } from './ui'

/**
 * „Zaległe posiłki”: past plan entries that never got a cook-log entry. No longer a pop-up over
 * the library — Plan shows a one-line notice and the sheet opens on request. In the sheet, rows
 * are grouped by day; tick several and save them in one go (dated on the planned day — rating and
 * note can be added later in Historia gotowania), or skip one for good (meal not cooked).
 */
export function PendingCookNotice() {
  const { canEdit } = useAuth()
  const { data: pending = [] } = usePendingCook(canEdit)
  const [open, setOpen] = useState(false)
  if (!canEdit || pending.length === 0) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 0', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
      >
        <span style={{ width: 8, height: 8, flex: '0 0 8px', borderRadius: '50%', background: 'var(--accent)' }} />
        <span style={{ flex: 1, minWidth: 0, font: sans(14.5) }}>
          {plural(pending.length, 'posiłek czeka', 'posiłki czekają', 'posiłków czeka')} na potwierdzenie
        </span>
        <span style={{ font: sans(14, 600), color: 'var(--accent-text)', whiteSpace: 'nowrap' }}>Przejrzyj ›</span>
      </button>
      <PendingCookSheet open={open} onClose={() => setOpen(false)} pending={pending} />
    </>
  )
}

/** One cook-log entry covers every plan entry of the same dish within a day (PlanShoppingService.IsCooked). */
const dishKey = (e: PlanEntry) => `${e.recipeId ?? (e.recipeTitle ?? e.title ?? '').toLowerCase()}|${e.date}`

function PendingCookSheet({ open, onClose, pending }: { open: boolean; onClose: () => void; pending: PlanEntry[] }) {
  const addLog = useAddCookLog()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const days = useMemo(() => {
    const by = new Map<string, PlanEntry[]>()
    for (const e of pending) by.set(e.date, [...(by.get(e.date) ?? []), e])
    return [...by.entries()]
  }, [pending])
  const chosen = pending.filter((e) => picked.has(e.id))

  const toggle = (id: string) => setPicked((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  async function saveChosen() {
    setSaving(true)
    const seen = new Set<string>()
    let saved = 0
    try {
      for (const e of chosen) {
        const key = dishKey(e)
        if (seen.has(key)) continue
        seen.add(key)
        const title = e.recipeTitle ?? e.title
        await addLog.mutateAsync({ recipeId: e.recipeId ?? undefined, dishName: e.recipeId ? undefined : title, cookedAt: e.date })
        saved++
      }
      showToast(`Zapisano w historii: ${plural(saved, 'danie', 'dania', 'dań')}.`)
      setPicked(new Set())
      if (chosen.length === pending.length) onClose()
    } catch {
      // the global mutation toast says what went wrong; what was saved stays saved
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Zaległe posiłki"
      width={540}
      footer={
        <>
          <Button variant="quiet" size="xl" onClick={onClose}>Później</Button>
          <Button size="xl" style={{ flex: 1, minWidth: 0 }} disabled={chosen.length === 0 || saving} onClick={saveChosen}>
            {saving ? 'Zapisuję…' : chosen.length === 0 ? 'Zaznacz ugotowane' : `Zapisz ${chosen.length} jako ugotowane`}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <span style={{ font: sans(14.5), lineHeight: 1.5, color: 'var(--text-2)' }}>
          Te zaplanowane posiłki nie mają wpisu w historii gotowania. Zaznacz ugotowane — ocenę i notatkę dopiszesz później.
        </span>
        {days.map(([date, entries]) => (
          <div key={date} style={{ display: 'flex', flexDirection: 'column' }}>
            <Eyebrow style={{ paddingBottom: 6, borderBottom: '1px solid var(--rule)' }}>
              {parseISODate(date).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Eyebrow>
            {entries.map((e) => <PendingRow key={e.id} entry={e} picked={picked.has(e.id)} onToggle={() => toggle(e.id)} disabled={saving} />)}
          </div>
        ))}
      </div>
    </Sheet>
  )
}

function PendingRow({ entry, picked, onToggle, disabled }: { entry: PlanEntry; picked: boolean; onToggle: () => void; disabled: boolean }) {
  const dismiss = useDismissCookReminder()
  const title = entry.recipeTitle ?? entry.title
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--border)' }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={picked}
        onClick={onToggle}
        disabled={disabled}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
      >
        <span style={{ width: 26, height: 26, flex: '0 0 26px', borderRadius: '50%', border: picked ? 0 : '1.5px solid var(--rule)', background: picked ? 'var(--sage)' : 'transparent', color: '#fff', font: sans(13, 700), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {picked ? '✓' : ''}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 18, lineHeight: 1.2 }}>{title}</span>
          <span style={{ font: mono(11.5), color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{slotLabel[entry.slot]}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => dismiss.mutate(entry.id)}
        disabled={disabled || dismiss.isPending}
        title="Nie przypominaj o tym posiłku (np. pominięty)"
        style={{ height: 44, padding: '0 6px', border: 0, background: 'transparent', cursor: 'pointer', font: sans(13.5, 600), color: 'var(--text-3)' }}
      >
        Pomiń
      </button>
    </div>
  )
}
