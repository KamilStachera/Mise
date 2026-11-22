import { useEffect, useState } from 'react'
import { errorText, type MealSlotInput } from '../../api/client'
import { usePerson, useSaveMeals } from '../../api/hooks'
import { useDayMeals } from '../../lib/meals'
import { showToast } from '../../lib/toastBus'
import { Button, Chip, Eyebrow, SectionHead, Sheet, inputStyle, sans } from '../ui'

const MAX_MEALS = 8
const SUGGESTIONS = ['Drugie śniadanie', 'Lunch', 'Podwieczorek', 'Kolacja', 'Przekąski']

type Row = MealSlotInput & { id: string }

/**
 * „Posiłki dnia” in Profil: the acting person's meals (each person has their own day). The
 * summary line opens {@link MealsSheet}.
 */
export function MealsCard() {
  const meals = useDayMeals()
  const { person, people } = usePerson()
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionHead title="Posiłki dnia" meta={people.length > 1 && person ? person.name : undefined} size={20} />
      <span style={{ font: sans(15), lineHeight: 1.5 }}>{meals.all.map((m) => m.name).join(' · ')}</span>
      <span style={{ font: sans(13), color: 'var(--text-2)', lineHeight: 1.5 }}>
        Na tyle części dzielą się Twój plan i dziennik. Każdy domownik ma własne — np. „Lunch” w pracy obok obiadu.
      </span>
      <Button variant="outline" size="sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>Zmień posiłki</Button>
      <MealsSheet open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

/** Edit the day: rename, reorder, add, remove (removed meals keep their past entries), mark snack meals. */
export function MealsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meals = useDayMeals()
  const save = useSaveMeals()
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRows(meals.all.map((m) => ({ id: m.key, key: m.key, name: m.name, snack: m.snack })))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, by: number) => {
    const next = [...rows]
    const [row] = next.splice(i, 1)
    next.splice(i + by, 0, row)
    setRows(next)
  }
  const add = (name = '') => {
    if (rows.length >= MAX_MEALS) return
    const row: Row = { id: `new-${Date.now()}`, name, snack: /przek/i.test(name) }
    // A suggested meal goes where it belongs in the day; a blank one goes last.
    const before = name === 'Drugie śniadanie' ? 1 : name === 'Lunch' ? rows.findIndex((r) => r.key === 'lunch') : name === 'Podwieczorek' ? rows.findIndex((r) => r.key === 'dinner') : -1
    const at = before >= 0 ? before : rows.length
    setRows([...rows.slice(0, at), row, ...rows.slice(at)])
  }
  const taken = new Set(rows.map((r) => r.name.trim().toLowerCase()))
  const suggestions = SUGGESTIONS.filter((s) => !taken.has(s.toLowerCase()))

  async function onSave() {
    setError(null)
    try {
      await save.mutateAsync(rows.map(({ key, name, snack }) => ({ key, name: name.trim(), snack })))
      showToast('Zapisano posiłki dnia')
      onClose()
    } catch (e) {
      setError(errorText(e, 'Nie udało się zapisać posiłków.'))
    }
  }

  const iconBtn = (disabled: boolean) => ({
    width: 34, height: 34, border: 0, background: 'transparent', borderRadius: 8, font: sans(16, 600),
    color: disabled ? 'var(--text-3)' : 'var(--text-2)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
  } as const)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Zmień posiłki"
      width={520}
      footer={
        <Button size="xl" style={{ width: '100%' }} onClick={onSave} disabled={save.isPending || rows.some((r) => !r.name.trim())}>
          {save.isPending ? 'Zapisuję…' : 'Zapisz posiłki'}
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ font: sans(14), color: 'var(--text-2)', lineHeight: 1.5 }}>
          Kolejność to kolejność w ciągu dnia. Usunięty posiłek znika z planu, ale to, co już w nim zapisane, zostaje.
          Posiłek oznaczony jako przekąski jest prywatny i nie trafia do zakupów.
        </span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r, i) => (
            <div key={r.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  value={r.name}
                  maxLength={30}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Nazwa posiłku"
                  aria-label={`Posiłek ${i + 1}`}
                  autoFocus={r.id.startsWith('new-') && !r.name}
                />
                <Chip active={r.snack} onClick={() => update(i, { snack: !r.snack })} title="Przekąski: prywatne, bez zakupów" style={{ marginLeft: 4 }}>
                  przekąski
                </Chip>
                <button type="button" aria-label="Wyżej" disabled={i === 0} onClick={() => move(i, -1)} style={iconBtn(i === 0)}>↑</button>
                <button type="button" aria-label="Niżej" disabled={i === rows.length - 1} onClick={() => move(i, 1)} style={iconBtn(i === rows.length - 1)}>↓</button>
                <button type="button" aria-label={`Usuń ${r.name}`} disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} style={iconBtn(rows.length <= 1)}>×</button>
              </div>
            </div>
          ))}
        </div>
        <Button variant="outline" disabled={rows.length >= MAX_MEALS} onClick={() => add()}>+ Dodaj posiłek</Button>
        {suggestions.length > 0 && rows.length < MAX_MEALS && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Eyebrow>Podpowiedzi</Eyebrow>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {suggestions.map((s) => <Chip key={s} onClick={() => add(s)}>+ {s}</Chip>)}
            </div>
          </div>
        )}
        {error && <span role="alert" style={{ font: sans(14), color: 'var(--accent-text)' }}>{error}</span>}
      </div>
    </Sheet>
  )
}
