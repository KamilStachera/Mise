import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, usePantry, usePlan, usePlanAddMissing, usePlanShoppingPreview, useRecipes, useSetPlanEntry, useDeletePlanEntry } from '../api/hooks'
import type { PantryConfirmation, PantryItem, PlanEntry, ShoppingPreviewItem, Slot } from '../api/client'
import { formatGrams, formatQty, slotLabel, SLOTS, DAY_NAMES_PL } from '../lib/labels'
import { CheckIcon, PlusIcon } from '../components/icons'

const cardStyle: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 15,
  padding: '19px 21px',
}
const capStyle: CSSProperties = {
  font: "700 11px 'Hanken Grotesk'",
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  marginBottom: 11,
}
const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  borderRadius: 9,
  padding: '8px 11px',
  font: "400 14px 'Hanken Grotesk'",
  color: 'var(--text)',
}
const ghostBtn: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  borderRadius: 10,
  padding: '8px 14px',
  cursor: 'pointer',
  font: "500 13px 'Hanken Grotesk'",
}
const primaryBtn: CSSProperties = {
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  borderRadius: 10,
  padding: '8px 16px',
  cursor: 'pointer',
  font: "600 13px 'Hanken Grotesk'",
}

// Local-time date helpers (the API talks plain YYYY-MM-DD).
function toISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}.${m}`
}

type CellRef = { date: string; slot: Slot }

export function Plan() {
  const { canEdit } = useAuth()
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const startISO = toISO(weekStart)
  const todayISO = toISO(new Date())
  const { data: plan } = usePlan(startISO)
  const { data: recipes } = useRecipes('all', '')
  const addMissing = usePlanAddMissing()
  const previewShopping = usePlanShoppingPreview()
  const { data: pantryGroups = [] } = usePantry()
  const [editing, setEditing] = useState<CellRef | null>(null)
  const [shopMsg, setShopMsg] = useState<string | null>(null)
  const [reviewItems, setReviewItems] = useState<ShoppingPreviewItem[] | null>(null)

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => toISO(addDays(weekStart, i))), [weekStart])
  const entryAt = (date: string, slot: Slot): PlanEntry | undefined =>
    plan?.entries.find((e) => e.date === date && e.slot === slot)

  // Per-day macro sums (one serving per entry) — only entries whose linked
  // recipe has a kcal estimate count; days with no data show nothing.
  const macrosByDay = useMemo(() => {
    const byId = new Map((recipes ?? []).map((r) => [r.id, r]))
    const sums = new Map<string, { kcal: number; protein: number }>()
    for (const e of plan?.entries ?? []) {
      const r = e.recipeId ? byId.get(e.recipeId) : undefined
      if (!r || r.kcal == null) continue
      const day = sums.get(e.date) ?? { kcal: 0, protein: 0 }
      day.kcal += r.kcal
      day.protein += r.protein ?? 0
      sums.set(e.date, day)
    }
    return sums
  }, [plan, recipes])

  async function onAddMissing() {
    setShopMsg(null)
    const preview = await previewShopping.mutateAsync({ start: startISO, days: 7 })
    const uncertain = preview.items.filter((item) => item.needsConfirmation)
    if (uncertain.length > 0) {
      setReviewItems(uncertain)
      return
    }
    await commitShopping([])
  }

  async function commitShopping(confirmations: PantryConfirmation[]) {
    const r = await addMissing.mutateAsync({ start: startISO, days: 7, confirmations })
    const parts = [
      r.added > 0 ? `dodano ${r.added}` : '',
      r.updated > 0 ? `zaktualizowano ${r.updated}` : '',
    ].filter(Boolean)
    setShopMsg(parts.length > 0
      ? `${parts.join(', ')} pozycji na liście zakupów.`
      : 'Wszystko z tego tygodnia już masz (lub jest na liście).')
    setReviewItems(null)
  }

  return (
    <div style={{ maxWidth: 1150, margin: '0 auto', padding: '38px 42px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px 14px', marginBottom: 6 }}>
        <div>
          <div style={{ font: "600 11px 'Hanken Grotesk'", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 7 }}>
            Co jemy w tym tygodniu
          </div>
          <h1 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 38, margin: 0 }}>Plan posiłków</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={ghostBtn} onClick={() => { setWeekStart((w) => addDays(w, -7)); setEditing(null); setReviewItems(null) }}>‹ Poprzedni</button>
          <button style={ghostBtn} onClick={() => { setWeekStart(mondayOf(new Date())); setEditing(null); setReviewItems(null) }}>Dziś</button>
          <button style={ghostBtn} onClick={() => { setWeekStart((w) => addDays(w, 7)); setEditing(null); setReviewItems(null) }}>Następny ›</button>
        </div>
      </div>
      <p style={{ fontSize: 14.5, color: 'var(--text-2)', margin: '0 0 24px', maxWidth: '68ch' }}>
        Tydzień {shortDate(days[0])} – {shortDate(days[6])}. Plan trafia do <code style={{ font: "500 12.5px 'Spline Sans Mono'" }}>plan.md</code> w
        folderze context — asystent może go czytać i uzupełniać przez API.
      </p>

      {/* Fixed 8-column week grid — scrolls sideways on phones instead of crushing. */}
      <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '86px repeat(7, 1fr)', gap: 6, minWidth: 860 }}>
        <div />
        {days.map((d, i) => (
          <div key={d} style={{ textAlign: 'center', padding: '4px 0 8px' }}>
            <div style={{ font: "600 12px 'Hanken Grotesk'", color: d === todayISO ? 'var(--accent-deep)' : 'var(--text-2)' }}>{DAY_NAMES_PL[i]}</div>
            <div style={{ font: "500 11px 'Spline Sans Mono'", color: d === todayISO ? 'var(--accent)' : 'var(--text-3)', marginTop: 2 }}>{shortDate(d)}</div>
            {macrosByDay.has(d) && (
              <div style={{ font: "500 10px 'Spline Sans Mono'", color: 'var(--text-3)', marginTop: 3 }} title="Suma z zaplanowanych przepisów (na porcję); wpisy bez oszacowania pominięte">
                ~{macrosByDay.get(d)!.kcal} kcal
                {macrosByDay.get(d)!.protein > 0 && ` · B ${formatGrams(macrosByDay.get(d)!.protein)}`}
              </div>
            )}
          </div>
        ))}

        {SLOTS.map((slot) => (
          <SlotRow
            key={slot}
            slot={slot}
            days={days}
            todayISO={todayISO}
            entryAt={entryAt}
            onCell={(ref) => canEdit && setEditing((cur) => (cur && cur.date === ref.date && cur.slot === ref.slot ? null : ref))}
            editing={editing}
            canEdit={canEdit}
          />
        ))}
      </div>
      </div>

      {editing && (
        <CellEditor
          key={`${editing.date}|${editing.slot}`}
          cell={editing}
          entry={entryAt(editing.date, editing.slot)}
          onClose={() => setEditing(null)}
        />
      )}

      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
          <button disabled={addMissing.isPending || previewShopping.isPending} onClick={onAddMissing} style={{ ...primaryBtn, display: 'flex', alignItems: 'center', gap: 7 }}>
            <PlusIcon /> {addMissing.isPending || previewShopping.isPending ? 'Sprawdzam…' : 'Dodaj brakujące składniki z tego tygodnia do zakupów'}
          </button>
          {shopMsg && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{shopMsg}</span>}
        </div>
      )}
      {reviewItems && (
        <ShoppingReview
          items={reviewItems}
          pantry={pantryGroups.flatMap((group) => group.items)}
          pending={addMissing.isPending}
          onCancel={() => setReviewItems(null)}
          onCommit={commitShopping}
        />
      )}
    </div>
  )
}

function ShoppingReview({ items, pantry, pending, onCancel, onCommit }: {
  items: ShoppingPreviewItem[]
  pantry: PantryItem[]
  pending: boolean
  onCancel: () => void
  onCommit: (confirmations: PantryConfirmation[]) => Promise<void>
}) {
  const byId = new Map(pantry.map((item) => [item.id, item]))
  const reviewable = items.flatMap((item) => item.pantryItemId
    ? [byId.get(item.pantryItemId)].filter(Boolean) as PantryItem[]
    : (item.alternativePantryItemIds ?? []).map((id) => byId.get(id)).filter(Boolean) as PantryItem[])
    .filter((item, index, all) => all.findIndex((x) => x.id === item.id) === index)
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(
    reviewable.map((item) => [item.id, String(item.quantity).replace('.', ',')]),
  ))
  const [confirmed, setConfirmed] = useState<Record<string, number>>({})

  const setValue = (item: PantryItem, value: number) => {
    setDrafts((current) => ({ ...current, [item.id]: String(value).replace('.', ',') }))
    setConfirmed((current) => ({ ...current, [item.id]: value }))
  }
  const acceptCustom = (item: PantryItem) => {
    const value = Number((drafts[item.id] ?? '').replace(',', '.'))
    if (Number.isFinite(value) && value >= 0) setConfirmed((current) => ({ ...current, [item.id]: value }))
  }

  return (
    <div style={{ ...cardStyle, marginTop: 16, borderColor: 'var(--gold)' }}>
      <div style={{ ...capStyle, color: 'var(--gold)' }}>Krótki przegląd przed zakupami</div>
      <p style={{ margin: '0 0 14px', color: 'var(--text-2)', fontSize: 13.5 }}>
        Pytamy tylko o składniki, dla których niepewność zmienia listę. Możesz nic nie zaznaczać — wtedy policzymy zakupy bezpiecznie.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((preview) => {
          const options = preview.pantryItemId
            ? [byId.get(preview.pantryItemId)].filter(Boolean) as PantryItem[]
            : (preview.alternativePantryItemIds ?? []).map((id) => byId.get(id)).filter(Boolean) as PantryItem[]
          return (
            <div key={preview.key} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontWeight: 650, fontSize: 14 }}>{preview.name}</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, margin: '2px 0 7px' }}>
                {preview.requiredQuantity != null && preview.unit ? `potrzeba ${formatQty(preview.requiredQuantity, preview.unit)}` : 'sprawdź, czy któryś zamiennik jest w domu'}
                {' · '}{preview.sources.join(', ')}
              </div>
              {preview.unit && preview.estimatedQuantity != null && preview.planningQuantity != null && (
                <div style={{ color: 'var(--text-2)', fontSize: 12, marginBottom: 7 }}>
                  szacunek: ~{formatQty(preview.estimatedQuantity, preview.unit)} · bezpiecznie: {formatQty(preview.planningQuantity, preview.unit)}
                  {preview.suggestedPurchase != null && ` · bez korekty kupimy ${formatQty(preview.suggestedPurchase, preview.unit)}`}
                </div>
              )}
              {options.map((item) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', margin: '5px 0' }}>
                  <span style={{ width: 150, fontSize: 13 }}>{item.name}: ~{formatQty(item.quantity, item.unit)}</span>
                  <button style={{ ...ghostBtn, padding: '5px 9px', background: confirmed[item.id] === item.quantity ? 'var(--accent-soft)' : 'var(--card)' }} onClick={() => setValue(item, item.quantity)}>Zgadza się</button>
                  <button style={{ ...ghostBtn, padding: '5px 9px', background: confirmed[item.id] === 0 ? 'var(--accent-soft)' : 'var(--card)' }} onClick={() => setValue(item, 0)}>Brak</button>
                  <input value={drafts[item.id] ?? ''} onChange={(e) => setDrafts((current) => ({ ...current, [item.id]: e.target.value }))} inputMode="decimal" style={{ ...inputStyle, width: 70, padding: '5px 8px' }} />
                  <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{item.unit}</span>
                  <button style={{ ...ghostBtn, padding: '5px 9px' }} onClick={() => acceptCustom(item)}>Mam inaczej</button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 15 }}>
        <button style={primaryBtn} disabled={pending} onClick={() => onCommit(Object.entries(confirmed).map(([pantryItemId, quantity]) => ({ pantryItemId, quantity })))}>
          {pending ? 'Dodaję…' : 'Przelicz i dodaj do zakupów'}
        </button>
        <button style={ghostBtn} onClick={onCancel}>Anuluj</button>
      </div>
    </div>
  )
}

function SlotRow({ slot, days, todayISO, entryAt, onCell, editing, canEdit }: {
  slot: Slot
  days: string[]
  todayISO: string
  entryAt: (date: string, slot: Slot) => PlanEntry | undefined
  onCell: (ref: CellRef) => void
  editing: CellRef | null
  canEdit: boolean
}) {
  return (
    <>
      <div style={{ ...capStyle, marginBottom: 0, alignSelf: 'center' }}>{slotLabel[slot]}</div>
      {days.map((date) => {
        const entry = entryAt(date, slot)
        const active = editing?.date === date && editing?.slot === slot
        return (
          <button
            key={date}
            onClick={() => onCell({ date, slot })}
            style={{
              ...cardStyle,
              position: 'relative',
              padding: '10px 11px',
              minHeight: 74,
              textAlign: 'left',
              cursor: canEdit ? 'pointer' : 'default',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              alignItems: entry ? 'flex-start' : 'center',
              justifyContent: entry ? 'flex-start' : 'center',
              border: active
                ? '1px solid var(--accent)'
                : date === todayISO
                  ? '1px solid var(--border-2)'
                  : '1px solid var(--border)',
              background: entry ? 'var(--card)' : 'var(--surface)',
            }}
          >
            {entry?.cooked && (
              <span
                title="Ugotowane — jest wpis w historii gotowania"
                style={{ position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: '50%', background: 'var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <CheckIcon size={10} />
              </span>
            )}
            {entry ? (
              <>
                <span style={{ font: "600 12.5px 'Hanken Grotesk'", color: 'var(--text)', lineHeight: 1.3, paddingRight: entry.cooked ? 16 : 0 }}>
                  {entry.recipeTitle ?? entry.title}
                </span>
                {entry.note && <span style={{ font: "400 11px 'Hanken Grotesk'", color: 'var(--text-3)', lineHeight: 1.3 }}>{entry.note}</span>}
              </>
            ) : (
              <span style={{ color: 'var(--text-3)', fontSize: 16, lineHeight: 1 }}>+</span>
            )}
          </button>
        )
      })}
    </>
  )
}

function CellEditor({ cell, entry, onClose }: { cell: CellRef; entry?: PlanEntry; onClose: () => void }) {
  const nav = useNavigate()
  const setEntry = useSetPlanEntry()
  const delEntry = useDeletePlanEntry()
  const [mode, setMode] = useState<'recipe' | 'text'>(entry && !entry.recipeId ? 'text' : 'recipe')
  const [recipeId, setRecipeId] = useState<string | null>(entry?.recipeId ?? null)
  const [filter, setFilter] = useState('')
  const [title, setTitle] = useState(entry?.recipeId ? '' : (entry?.title ?? ''))
  const [note, setNote] = useState(entry?.note ?? '')
  const { data: recipes } = useRecipes('all', '')

  const matches = (recipes ?? []).filter((r) => r.title.toLowerCase().includes(filter.toLowerCase())).slice(0, 8)
  const canSave = mode === 'recipe' ? !!recipeId : title.trim().length > 0

  async function onSave() {
    await setEntry.mutateAsync({
      date: cell.date,
      slot: cell.slot,
      recipeId: mode === 'recipe' ? recipeId : null,
      title: mode === 'text' ? title.trim() : '',
      note: note.trim(),
    })
    onClose()
  }

  async function onDelete() {
    if (entry) await delEntry.mutateAsync(entry.id)
    onClose()
  }

  const modeBtn = (active: boolean): CSSProperties => ({
    ...ghostBtn,
    padding: '6px 12px',
    background: active ? 'var(--accent-soft)' : 'var(--card)',
    color: active ? 'var(--accent-deep)' : 'var(--text-2)',
    borderColor: active ? 'var(--accent)' : 'var(--border)',
  })

  return (
    <div style={{ ...cardStyle, marginTop: 16 }}>
      <div style={capStyle}>
        {slotLabel[cell.slot]} · {shortDate(cell.date)}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button style={modeBtn(mode === 'recipe')} onClick={() => setMode('recipe')}>Zapisany przepis</button>
        <button style={modeBtn(mode === 'text')} onClick={() => setMode('text')}>Własne danie</button>
      </div>

      {mode === 'recipe' ? (
        <>
          <input
            style={{ ...inputStyle, marginBottom: 8 }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Szukaj przepisu…"
            autoFocus
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
            {matches.map((r) => (
              <button
                key={r.id}
                onClick={() => setRecipeId(r.id)}
                style={{
                  ...ghostBtn,
                  padding: '6px 11px',
                  fontSize: 12.5,
                  background: recipeId === r.id ? 'var(--accent-soft)' : 'var(--surface)',
                  borderColor: recipeId === r.id ? 'var(--accent)' : 'var(--border)',
                  color: recipeId === r.id ? 'var(--accent-deep)' : 'var(--text)',
                }}
              >
                {r.title} · {r.time} min
              </button>
            ))}
            {matches.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Brak pasujących przepisów.</span>}
          </div>
        </>
      ) : (
        <input
          style={{ ...inputStyle, marginBottom: 12 }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="np. Pizza na mieście, resztki z wczoraj…"
          autoFocus
        />
      )}

      <input
        style={{ ...inputStyle, marginBottom: 14 }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notatka (np. podwójna porcja, lunch na jutro)…"
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={{ ...primaryBtn, opacity: canSave ? 1 : 0.5 }} disabled={!canSave} onClick={onSave}>
          {setEntry.isPending ? 'Zapisywanie…' : 'Zapisz'}
        </button>
        <button style={ghostBtn} onClick={onClose}>Anuluj</button>
        <div style={{ flex: 1 }} />
        {entry?.recipeId && (
          <button style={ghostBtn} onClick={() => nav(`/recipe/${entry.recipeId}`)}>Otwórz przepis</button>
        )}
        {entry && (
          <button style={{ ...ghostBtn, color: 'var(--accent)' }} onClick={onDelete}>
            {delEntry.isPending ? 'Usuwanie…' : 'Usuń wpis'}
          </button>
        )}
      </div>
    </div>
  )
}
