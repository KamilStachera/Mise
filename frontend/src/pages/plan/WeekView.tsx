import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, usePantry, usePlan, usePlanAddMissing, usePlanShoppingPreview, useRecipes, useSetPlanEntry, useDeletePlanEntry } from '../api/hooks'
import type { PantryConfirmation, PantryItem, PlanEntry, RecipeListItem, ShoppingPreviewItem, Slot } from '../api/client'
import { formatGrams, formatQty, slotLabel, SLOTS, DAY_NAMES_PL } from '../lib/labels'
import { WEEKDAY_SHORT, addDays, dayMonth, mondayOf, parseISODate, toISO } from '../lib/dates'
import { useIsMobile } from '../lib/useIsMobile'
import { RecipeThumb } from '../components/RecipeThumb'
import { TAB_BAR_HEIGHT } from '../components/TabBar'
import { Button, Eyebrow, PageTitle, Segmented, Sheet, inputStyle, mono, sans, usePagePad } from '../components/ui'

const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

type CellRef = { date: string; slot: Slot }

export function Plan() {
  const { canEdit } = useAuth()
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
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
  const recipeById = useMemo(() => new Map((recipes ?? []).map((r) => [r.id, r])), [recipes])
  const entryAt = (date: string, slot: Slot): PlanEntry | undefined =>
    plan?.entries.find((e) => e.date === date && e.slot === slot)
  const planned = (plan?.entries ?? []).filter((e) => days.includes(e.date)).length

  // Per-day macro sums (one serving per entry) — only entries whose linked
  // recipe has a kcal estimate count; days with no data show nothing.
  const macrosByDay = useMemo(() => {
    const sums = new Map<string, { kcal: number; protein: number }>()
    for (const e of plan?.entries ?? []) {
      const r = e.recipeId ? recipeById.get(e.recipeId) : undefined
      if (!r || r.kcal == null) continue
      const day = sums.get(e.date) ?? { kcal: 0, protein: 0 }
      day.kcal += r.kcal
      day.protein += r.protein ?? 0
      sums.set(e.date, day)
    }
    return sums
  }, [plan, recipeById])

  const macroLine = (date: string) => {
    const m = macrosByDay.get(date)
    if (!m) return '—'
    return `~${m.kcal} kcal${m.protein > 0 ? ` · B ${formatGrams(m.protein)}` : ''}`
  }

  function goWeek(next: Date) {
    setWeekStart(next)
    setEditing(null)
    setReviewItems(null)
    setShopMsg(null)
  }

  function onCell(ref: CellRef) {
    if (canEdit) setEditing(ref)
    else {
      const recipeId = entryAt(ref.date, ref.slot)?.recipeId
      if (recipeId) nav(`/recipe/${recipeId}`)
    }
  }

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
      ? `Gotowe: ${parts.join(', ')} pozycji na liście zakupów.`
      : 'Wszystko z tego tygodnia już masz (lub jest na liście).')
    setReviewItems(null)
  }

  const busy = addMissing.isPending || previewShopping.isPending
  const first = parseISODate(days[0])
  const last = parseISODate(days[6])

  const sheets = (
    <>
      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${slotLabel[editing.slot]} · ${WEEKDAY_SHORT[days.indexOf(editing.date)] ?? ''} ${dayMonth(parseISODate(editing.date))}` : ''}
        width={560}
      >
        {editing && (
          <CellEditor key={`${editing.date}|${editing.slot}`} cell={editing} entry={entryAt(editing.date, editing.slot)} onClose={() => setEditing(null)} />
        )}
      </Sheet>
      <Sheet open={!!reviewItems} onClose={() => setReviewItems(null)} title="Krótki przegląd" width={620}>
        {reviewItems && (
          <ShoppingReview
            items={reviewItems}
            pantry={pantryGroups.flatMap((group) => group.items)}
            pending={addMissing.isPending}
            onCancel={() => setReviewItems(null)}
            onCommit={commitShopping}
          />
        )}
      </Sheet>
    </>
  )

  if (isMobile) {
    return (
      <div style={{ ...pad, paddingBottom: canEdit ? 96 : 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PageTitle
          title="Plan"
          right={
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, font: sans(14, 600) }}>
              <button type="button" aria-label="Poprzedni tydzień" onClick={() => goWeek(addDays(weekStart, -7))} style={arrowBtn}>‹</button>
              <button type="button" onClick={() => goWeek(mondayOf(new Date()))} style={{ ...arrowBtn, width: 'auto' }} title="Ten tydzień">
                {first.getDate()}–{last.getDate()} {MONTHS_SHORT[last.getMonth()]}
              </button>
              <button type="button" aria-label="Następny tydzień" onClick={() => goWeek(addDays(weekStart, 7))} style={arrowBtn}>›</button>
            </span>
          }
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', padding: '10px 0' }}>
          {days.map((d, i) => {
            const today = d === todayISO
            return (
              <button
                key={d}
                type="button"
                onClick={() => document.getElementById(`plan-day-${d}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '4px 0', border: 0, borderRadius: 10, background: today ? 'var(--text)' : 'transparent', color: today ? 'var(--bg)' : 'var(--text)', cursor: 'pointer' }}
              >
                <span style={{ font: mono(10.5, 500), color: today ? 'var(--on-dark-muted)' : 'var(--text-3)' }}>{WEEKDAY_SHORT[i].slice(0, 2).toUpperCase()}</span>
                <span style={{ font: mono(16, 500) }}>{parseISODate(d).getDate()}</span>
                <span style={{ display: 'flex', gap: 2 }}>
                  {SLOTS.map((s) => {
                    const has = !!entryAt(d, s)
                    const ink = today ? 'var(--bg)' : 'var(--text)'
                    return <span key={s} style={{ width: 5, height: 5, borderRadius: '50%', boxSizing: 'border-box', background: has ? ink : 'transparent', border: has ? 0 : `1px solid ${ink}` }} />
                  })}
                </span>
              </button>
            )
          })}
        </div>
        {days.map((d, i) => (
          <div key={d} id={`plan-day-${d}`} style={{ display: 'flex', flexDirection: 'column', scrollMarginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '8px 0 6px', borderTop: i === 0 ? 0 : '1px solid var(--rule)' }}>
              <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 22 }}>
                {DAY_NAMES_PL[i]} <span style={{ fontStyle: 'italic', color: 'var(--text-3)' }}>{dayMonth(parseISODate(d))}</span>
              </span>
              <span style={{ font: mono(12), color: 'var(--text-2)' }}>{macrosByDay.has(d) ? macroLine(d) : ''}</span>
            </div>
            {SLOTS.map((s) => {
              const e = entryAt(d, s)
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onCell({ date: d, slot: s })}
                  style={{ display: 'flex', alignItems: e || !canEdit ? 'flex-start' : 'center', gap: 12, padding: e || !canEdit ? '11px 0' : '8px 0', border: 0, borderTop: '1px solid var(--border)', background: 'transparent', cursor: canEdit || e?.recipeId ? 'pointer' : 'default', textAlign: 'left', color: 'var(--text)' }}
                >
                  <span style={{ width: 74, flex: '0 0 74px', font: mono(10.5, 500), letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)', paddingTop: e ? 3 : 0 }}>{slotLabel[s]}</span>
                  {e ? (
                    <EntryText entry={e} recipe={e.recipeId ? recipeById.get(e.recipeId) : undefined} size={15} />
                  ) : canEdit ? (
                    <span style={{ flex: 1, height: 34, border: '1px dashed var(--border-2)', borderRadius: 9, display: 'flex', alignItems: 'center', padding: '0 12px', font: sans(14, 500), color: 'var(--text-2)' }}>+ Dodaj</span>
                  ) : (
                    <span style={{ color: 'var(--text-3)' }}>—</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
        {shopMsg && <span style={{ font: sans(14), color: 'var(--text-2)' }}>{shopMsg}</span>}
        {canEdit && (
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`, zIndex: 20, padding: '10px 16px', background: 'var(--bg)' }}>
            <Button size="xl" style={{ width: '100%' }} onClick={onAddMissing} disabled={busy}>
              {busy ? 'Sprawdzam…' : 'Dodaj brakujące składniki do zakupów'}
            </Button>
          </div>
        )}
        {sheets}
      </div>
    )
  }

  return (
    <div style={{ ...pad, maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <PageTitle
        title="Plan"
        sub={
          <>
            Tydzień {dayMonth(first)} – {dayMonth(last)}. Plan trafia do <span style={{ font: mono(13.5) }}>plan.md</span> w folderze context — asystent może go czytać i uzupełniać przez API.
          </>
        }
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="quiet" size="sm" onClick={() => goWeek(addDays(weekStart, -7))}>‹ Poprzedni</Button>
            <Button variant="dark" size="sm" onClick={() => goWeek(mondayOf(new Date()))}>Dziś</Button>
            <Button variant="quiet" size="sm" onClick={() => goWeek(addDays(weekStart, 7))}>Następny ›</Button>
          </div>
        }
      />

      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '88px repeat(7, minmax(0, 1fr))', borderTop: '1px solid var(--rule)', minWidth: 660 }}>
          <span />
          {days.map((d, i) => {
            const today = d === todayISO
            return (
              <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 12px', borderLeft: today ? 0 : '1px solid var(--border)', background: today ? 'var(--text)' : undefined, color: today ? 'var(--bg)' : undefined }}>
                <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 20 }}>
                  {WEEKDAY_SHORT[i]} <span style={{ fontStyle: 'italic', color: today ? 'var(--on-dark-muted)' : 'var(--text-3)' }}>{parseISODate(d).getDate()}</span>
                </span>
                <span style={{ font: mono(11), color: today ? 'var(--on-dark-muted)' : 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title="Suma z zaplanowanych przepisów (na porcję)">
                  {macroLine(d)}
                </span>
              </div>
            )
          })}

          {SLOTS.map((s, row) => {
            const top = row === 0 ? '1px solid var(--rule)' : '1px solid var(--border)'
            const bottom = row === SLOTS.length - 1 ? '1px solid var(--rule)' : undefined
            return [
              <span key={s} style={{ padding: '16px 0', borderTop: top, borderBottom: bottom, font: mono(10.5, 500), letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                {slotLabel[s]}
              </span>,
              ...days.map((d) => {
                const e = entryAt(d, s)
                const today = d === todayISO
                const cell: CSSProperties = {
                  display: 'flex',
                  minHeight: 118,
                  padding: e ? '14px 12px' : 10,
                  border: 0,
                  borderTop: top,
                  borderBottom: bottom ?? 0,
                  borderLeft: today ? 0 : '1px solid var(--border)',
                  background: today ? 'var(--surface)' : 'transparent',
                  textAlign: 'left',
                  cursor: canEdit || e?.recipeId ? 'pointer' : 'default',
                  color: 'var(--text)',
                  minWidth: 0,
                }
                return (
                  <button key={`${s}-${d}`} type="button" onClick={() => onCell({ date: d, slot: s })} style={cell}>
                    {e ? (
                      <EntryText entry={e} recipe={e.recipeId ? recipeById.get(e.recipeId) : undefined} size={14.5} />
                    ) : canEdit ? (
                      <span style={{ flex: 1, border: '1px dashed var(--border-2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'var(--text-3)' }}>+</span>
                    ) : null}
                  </button>
                )
              }),
            ]
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <span style={{ font: sans(14.5), color: 'var(--text-2)' }}>{shopMsg ?? `${planned} z 21 posiłków zaplanowanych`}</span>
        {canEdit && (
          <Button size="lg" onClick={onAddMissing} disabled={busy}>
            {busy ? 'Sprawdzam…' : 'Dodaj brakujące składniki z tego tygodnia do zakupów'}
          </Button>
        )}
      </div>
      {sheets}
    </div>
  )
}

const arrowBtn: CSSProperties = { width: 32, height: 36, border: 0, background: 'transparent', cursor: 'pointer', font: sans(14, 600), color: 'var(--text)' }

function EntryText({ entry, recipe, size }: { entry: PlanEntry; recipe?: RecipeListItem; size: number }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0, font: sans(size), lineHeight: 1.4 }}>
      {recipe?.sourceName && <Eyebrow size={10}>{recipe.sourceName}</Eyebrow>}
      <span>
        {entry.recipeTitle ?? entry.title}
        {entry.cooked && <span title="Ugotowane — jest wpis w historii" style={{ marginLeft: 6, color: 'var(--sage)', fontWeight: 600 }}>✓</span>}
      </span>
      {entry.note && <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>{entry.note}</span>}
    </span>
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

  const small: CSSProperties = { height: 34, padding: '0 12px', font: sans(13, 600) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ font: sans(14), lineHeight: 1.5, color: 'var(--text-2)' }}>
        Pytamy tylko o składniki, dla których niepewność zmienia listę. Możesz nic nie zaznaczać — wtedy policzymy zakupy bezpiecznie.
      </span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((preview) => {
          const options = preview.pantryItemId
            ? [byId.get(preview.pantryItemId)].filter(Boolean) as PantryItem[]
            : (preview.alternativePantryItemIds ?? []).map((id) => byId.get(id)).filter(Boolean) as PantryItem[]
          return (
            <div key={preview.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
              <span style={{ font: sans(15, 600) }}>{preview.name}</span>
              <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>
                {preview.requiredQuantity != null && preview.unit ? `potrzeba ${formatQty(preview.requiredQuantity, preview.unit)}` : 'sprawdź, czy któryś zamiennik jest w domu'}
                {' · '}{preview.sources.join(', ')}
              </span>
              {preview.unit && preview.estimatedQuantity != null && preview.planningQuantity != null && (
                <span style={{ font: mono(12), color: 'var(--text-2)' }}>
                  szacunek ~{formatQty(preview.estimatedQuantity, preview.unit)} · bezpiecznie {formatQty(preview.planningQuantity, preview.unit)}
                  {preview.suggestedPurchase != null && ` · bez korekty kupimy ${formatQty(preview.suggestedPurchase, preview.unit)}`}
                </span>
              )}
              {options.map((item) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 140, font: sans(13.5) }}>{item.name}: ~{formatQty(item.quantity, item.unit)}</span>
                  <Button size="sm" variant={confirmed[item.id] === item.quantity ? 'dark' : 'quiet'} style={small} onClick={() => setValue(item, item.quantity)}>Zgadza się</Button>
                  <Button size="sm" variant={confirmed[item.id] === 0 ? 'dark' : 'quiet'} style={small} onClick={() => setValue(item, 0)}>Brak</Button>
                  <input value={drafts[item.id] ?? ''} onChange={(e) => setDrafts((current) => ({ ...current, [item.id]: e.target.value }))} inputMode="decimal" style={{ ...inputStyle, width: 72, height: 34, padding: '0 8px', font: mono(13) }} />
                  <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>{item.unit}</span>
                  <Button size="sm" variant="quiet" style={small} onClick={() => acceptCustom(item)}>Mam inaczej</Button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button disabled={pending} onClick={() => onCommit(Object.entries(confirmed).map(([pantryItemId, quantity]) => ({ pantryItemId, quantity })))}>
          {pending ? 'Dodaję…' : 'Przelicz i dodaj do zakupów'}
        </Button>
        <Button variant="quiet" onClick={onCancel}>Anuluj</Button>
      </div>
    </div>
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

  const q = filter.trim().toLowerCase()
  const selected = (recipes ?? []).find((r) => r.id === recipeId)
  const matches = (recipes ?? [])
    .filter((r) => r.id !== recipeId && (!q || r.title.toLowerCase().includes(q)))
    .slice(0, selected ? 5 : 6)
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

  const recipeRow = (r: RecipeListItem, on: boolean) => (
    <button
      key={r.id}
      type="button"
      onClick={() => setRecipeId(on ? null : r.id)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', margin: '0 -10px', border: 0, borderRadius: 10, background: on ? 'var(--seg-bg)' : 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
    >
      <RecipeThumb r={r} letterSize={18} style={{ width: 40, height: 40, borderRadius: 8 }} />
      <span style={{ flex: 1, minWidth: 0, font: sans(14.5, on ? 600 : 400) }}>{r.title}</span>
      <span style={{ font: mono(12), color: 'var(--text-3)' }}>{on ? '✓' : `${r.time} min`}</span>
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Segmented
        value={mode}
        onChange={setMode}
        items={[
          { key: 'recipe', label: 'Zapisany przepis' },
          { key: 'text', label: 'Własne danie' },
        ]}
      />
      {mode === 'recipe' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input style={inputStyle} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Szukaj przepisu…" autoFocus />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {selected && recipeRow(selected, true)}
            {matches.map((r) => recipeRow(r, false))}
            {matches.length === 0 && !selected && <span style={{ font: sans(13.5), color: 'var(--text-3)', padding: '8px 0' }}>Brak pasujących przepisów.</span>}
          </div>
        </div>
      ) : (
        <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="np. Pizza na mieście, resztki z wczoraj…" autoFocus />
      )}
      <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notatka (np. podwójna porcja, lunch na jutro)…" />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button disabled={!canSave || setEntry.isPending} onClick={onSave}>{setEntry.isPending ? 'Zapisywanie…' : 'Zapisz'}</Button>
        {entry?.recipeId && <Button variant="quiet" onClick={() => nav(`/recipe/${entry.recipeId}`)}>Otwórz przepis</Button>}
        <span style={{ flex: 1 }} />
        {entry && (
          <Button variant="text" style={{ color: 'var(--accent-text)' }} onClick={onDelete}>
            {delEntry.isPending ? 'Usuwanie…' : 'Usuń wpis'}
          </Button>
        )}
      </div>
    </div>
  )
}
