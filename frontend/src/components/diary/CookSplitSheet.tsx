import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { CookAssignment, PlanEntry, Slot } from '../../api/client'
import { useAddDiaryEntry, useCook, useCreateCook, useUpdateCook } from '../../api/hooks'
import { WEEKDAY_SHORT, addDays, parseISODate, toISO } from '../../lib/dates'
import { SLOTS, slotLabel } from '../../lib/labels'
import { showToast } from '../../lib/toastBus'
import { Button, Eyebrow, Sheet, mono, sans } from '../ui'
import { CookMark, PortionDots } from './parts'

/** Where the pot comes from: a fresh plan, an existing planned meal, or an existing pot. */
export type CookOrigin =
  | { kind: 'new'; date?: string; slot?: Slot }
  | { kind: 'entry'; entry: PlanEntry }
  | { kind: 'edit'; cookId: string }

const MAX_PORTIONS = 12
const DAY_NAMES_FROM = ['niedzielę', 'poniedziałek', 'wtorek', 'środę', 'czwartek', 'piątek', 'sobotę']

function dayLabel(iso: string): string {
  const d = parseISODate(iso)
  return `${WEEKDAY_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()}`
}

/**
 * „Gotuję na kilka dni” (P8) — the pot's portions and which days eat them. The first row is
 * the cook day (only it buys ingredients); each further row is one leftover portion; whatever
 * is unassigned goes "W lodówce". With one portion and no extra days it is a plain plan entry.
 */
export function CookSplitSheet({ open, onClose, recipe, origin, title: sheetTitle = 'Gotuję na kilka dni' }: {
  open: boolean
  onClose: () => void
  /** Needed for kind new/entry; an edited pot carries its own. */
  recipe?: { id: string; title: string; kcal: number | null; servings?: number }
  origin: CookOrigin
  title?: string
}) {
  const today = toISO(new Date())
  const { data: cook } = useCook(open && origin.kind === 'edit' ? origin.cookId : null)
  const createCook = useCreateCook()
  const updateCook = useUpdateCook()
  const addEntry = useAddDiaryEntry()

  const [firstDate, setFirstDate] = useState(today)
  const [firstSlot, setFirstSlot] = useState<Slot>('dinner')
  const [portions, setPortions] = useState(2)
  const [rows, setRows] = useState<CookAssignment[]>([])

  // Entries of an edited pot that stay as they are: the cook day and leftovers already eaten.
  const fixed = useMemo(() => cook?.entries.filter((e) => !e.isLeftover || e.eaten) ?? [], [cook])

  // Callers build `origin` inline, so reset on its identity key, not the object.
  const originKey = origin.kind === 'new' ? `new|${origin.date}|${origin.slot}`
    : origin.kind === 'entry' ? `entry|${origin.entry.id}` : `edit|${origin.cookId}`
  useEffect(() => {
    if (!open) return
    if (origin.kind === 'new') {
      setFirstDate(origin.date ?? today)
      setFirstSlot(origin.slot ?? 'dinner')
      setPortions(Math.max(1, Math.min(MAX_PORTIONS, recipe?.servings ?? 2)))
      setRows([])
    } else if (origin.kind === 'entry') {
      setFirstDate(origin.entry.date)
      setFirstSlot(origin.entry.slot)
      setPortions(Math.max(2, Math.min(MAX_PORTIONS, recipe?.servings ?? 2)))
      setRows([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, originKey])

  useEffect(() => {
    if (!open || origin.kind !== 'edit' || !cook) return
    setFirstDate(cook.date)
    setPortions(cook.portions)
    setRows(cook.entries.filter((e) => e.isLeftover && !e.eaten).map((e) => ({ date: e.date, slot: e.slot })))
  }, [open, origin.kind, cook])

  const title = recipe?.title ?? cook?.title ?? ''
  const kcal = recipe?.kcal ?? cook?.kcalPerPortion ?? null
  const used = (origin.kind === 'edit' ? fixed.reduce((s, e) => s + e.portions, 0) + (cook?.discardedPortions ?? 0) : 1) + rows.length
  const left = Math.max(0, portions - used)
  const cookDayName = DAY_NAMES_FROM[parseISODate(firstDate).getDay()]

  const dayOptions = (from: string, count: number) => Array.from({ length: count }, (_, i) => toISO(addDays(parseISODate(from), i)))

  function addRow() {
    const last = rows.length > 0 ? rows[rows.length - 1].date : firstDate
    setRows([...rows, { date: toISO(addDays(parseISODate(last), 1)), slot: 'lunch' }])
  }

  async function save() {
    if (origin.kind === 'edit') {
      await updateCook.mutateAsync({ id: origin.cookId, portions, assignments: rows })
      showToast(`Zapisano: ${title}`)
    } else if (origin.kind === 'new' && portions === 1 && rows.length === 0) {
      await addEntry.mutateAsync({ date: firstDate, slot: firstSlot, recipeId: recipe!.id, portions: 1 })
      showToast(`Dodano do planu: ${title}`)
    } else {
      await createCook.mutateAsync({
        recipeId: recipe!.id,
        portions,
        firstDate,
        firstSlot,
        assignments: rows,
        fromEntryId: origin.kind === 'entry' ? origin.entry.id : undefined,
      })
      showToast(`Zaplanowano: ${title} · ${portions} porcji`)
    }
    onClose()
  }

  const busy = createCook.isPending || updateCook.isPending || addEntry.isPending
  const days = 1 + rows.length
  const cta = origin.kind === 'edit' ? 'Zapisz' : portions === 1 && rows.length === 0 ? 'Dodaj do planu' : days === 1 ? 'Zaplanuj gotowanie' : `Zaplanuj ${days} dni`
  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 50, borderTop: '1px solid var(--border)' }

  return (
    <Sheet open={open} onClose={onClose} title={sheetTitle} width={500}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ font: sans(15), color: 'var(--text-2)', marginTop: -6 }}>{title}</span>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Eyebrow>Porcje</Eyebrow>
            {kcal != null && <span style={{ font: mono(12.5), color: 'var(--text-2)' }}>{kcal} kcal / porcja</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <StepButton label="−" disabled={portions <= Math.max(1, used)} onClick={() => setPortions(portions - 1)} />
            <span style={{ font: mono(26, 500), minWidth: 28, textAlign: 'center' }}>{portions}</span>
            <span style={{ font: sans(14), color: 'var(--text-2)', width: 48 }}>{portions === 1 ? 'porcja' : portions < 5 ? 'porcje' : 'porcji'}</span>
            <StepButton label="+" disabled={portions >= MAX_PORTIONS} onClick={() => setPortions(portions + 1)} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Eyebrow style={{ paddingBottom: 8 }}>Kiedy jesz</Eyebrow>
          {origin.kind === 'new' ? (
            <div style={rowStyle}>
              <CookMark letter="A" filled />
              <Picker value={firstDate} onChange={setFirstDate} options={dayOptions(today, 14).map((d) => [d, dayLabel(d)])} />
              <span style={{ color: 'var(--text-3)' }}>·</span>
              <Picker value={firstSlot} onChange={(v) => setFirstSlot(v as Slot)} options={SLOTS.map((s) => [s, slotLabel[s]])} />
              <span style={{ flex: 1 }} />
              <GotujeTag />
            </div>
          ) : (
            (origin.kind === 'edit' ? fixed : [origin.entry]).map((e) => (
              <div key={e.id} style={rowStyle}>
                <CookMark letter="A" filled={!e.isLeftover} />
                <span style={{ font: sans(15, 500) }}>{dayLabel(e.date)} · {slotLabel[e.slot]}</span>
                <span style={{ flex: 1 }} />
                {e.isLeftover ? <span style={{ font: mono(11.5), color: 'var(--sage-text)' }}>zjedzone</span> : <GotujeTag />}
              </div>
            ))
          )}
          {rows.map((r, i) => (
            <div key={i} style={rowStyle}>
              <CookMark letter="A" filled={false} />
              <Picker
                value={r.date}
                onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, date: v } : x)))}
                options={dayOptions(firstDate, 8).map((d) => [d, dayLabel(d)])}
              />
              <span style={{ color: 'var(--text-3)' }}>·</span>
              <Picker
                value={r.slot}
                onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, slot: v as Slot } : x)))}
                options={SLOTS.map((s) => [s, slotLabel[s]])}
              />
              <span style={{ flex: 1 }} />
              <button type="button" aria-label="Usuń dzień" onClick={() => setRows(rows.filter((_, j) => j !== i))} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--text-2)', padding: '6px 4px' }}>×</button>
            </div>
          ))}
          <button
            type="button"
            disabled={left <= 0}
            onClick={addRow}
            style={{ marginTop: 10, height: 50, border: '1px dashed var(--border-2)', borderRadius: 12, background: 'transparent', font: sans(14.5, 600), color: left > 0 ? 'var(--text-2)' : 'var(--text-3)', cursor: left > 0 ? 'pointer' : 'not-allowed' }}
          >
            + Dodaj dzień
          </button>
        </div>

        {(portions > 1 || rows.length > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ font: sans(15, 500) }}>
              {left > 0 ? `zostaje ${left} ${left === 1 ? 'porcja' : left < 5 ? 'porcje' : 'porcji'} → W lodówce` : 'wszystkie porcje rozplanowane'}
            </span>
            <span style={{ font: sans(13), color: 'var(--text-2)' }}>Składniki kupujesz raz, na {cookDayName}.</span>
          </span>
          <PortionDots total={portions} left={left} />
        </div>
        )}

        <Button size="xl" disabled={busy || (origin.kind === 'edit' && !cook)} onClick={save}>
          {busy ? 'Zapisywanie…' : cta}
        </Button>
      </div>
    </Sheet>
  )
}

function GotujeTag() {
  return <span style={{ font: mono(11.5, 500), padding: '3px 8px', borderRadius: 6, background: 'var(--seg-bg)' }}>gotuję</span>
}

function StepButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label === '+' ? 'Więcej porcji' : 'Mniej porcji'}
      style={{ width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--rule)', background: 'transparent', font: sans(20), color: 'var(--text)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.35 : 1 }}
    >
      {label}
    </button>
  )
}

/** A native select dressed as row text — phones get their own picker for free. */
function Picker({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ appearance: 'none', border: 0, borderBottom: '1px dashed var(--border-2)', borderRadius: 0, background: 'transparent', padding: '4px 2px', font: sans(15, 500), color: 'var(--text)', cursor: 'pointer' }}
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}
