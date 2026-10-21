import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useBudget, usePantry, usePlan, usePlanAddMissing, usePlanShoppingPreview, useRecipes } from '../../api/hooks'
import type { PantryConfirmation, PantryItem, PlanEntry, ShoppingPreviewItem, Slot } from '../../api/client'
import { DAY_NAMES_PL, DIARY_SLOTS, SLOTS, formatKcal, formatQty, slotLabel, unitLabel } from '../../lib/labels'
import { MONTHS_SHORT, WEEKDAY_SHORT, addDays, dayShortMonth, mondayOf, parseISODate, toISO } from '../../lib/dates'
import { useIsMobile } from '../../lib/useIsMobile'
import { showToast } from '../../lib/toastBus'
import { CookMark, WeekDayBar, cookLetters, dayTotals, entryTitle, leftoverLabel, type DayTotals } from '../../components/diary/parts'
import { useDiarySheets } from '../../components/diary/useDiarySheets'
import { TAB_BAR_HEIGHT } from '../../components/TabBar'
import { Button, Eyebrow, PageTitle, Sheet, inputStyle, mono, sans, usePagePad } from '../../components/ui'

/**
 * „1 265 / 1 805”: everything eaten that day against the budget. Planned food only shows as
 * „~” while nothing is eaten yet (future days) — never added on top of the eaten total.
 */
function dayLabel(t: DayTotals, budget: number | null): string {
  const kcal = kcalText(t)
  if (!kcal) return budget != null ? `— / ${formatKcal(budget)}` : '—'
  return `${kcal}${budget != null ? ` / ${formatKcal(budget)}` : ' kcal'}`
}

/**
 * Plan → Tydzień (P7, D2): the week grid with Przekąski, several items per cell, pots
 * (letter marks + the W LODÓWCE row) and each day against the budget. Anonymous visitors see
 * meals only — the API already strips the private diary.
 */
export function WeekView({ weekStart, onWeek, onDay, switcher }: {
  weekStart: Date
  onWeek: (d: Date) => void
  onDay: (iso: string) => void
  switcher: ReactNode
}) {
  const { canEdit } = useAuth()
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const startISO = toISO(weekStart)
  const todayISO = toISO(new Date())
  const { data: plan } = usePlan(startISO)
  const { data: recipes } = useRecipes('all', '')
  const addMissing = usePlanAddMissing()
  const previewShopping = usePlanShoppingPreview()
  const { data: pantryGroups = [] } = usePantry()
  const [shopMsg, setShopMsg] = useState<string | null>(null)
  const [reviewItems, setReviewItems] = useState<ShoppingPreviewItem[] | null>(null)
  const { openAdd, openEntry, sheets } = useDiarySheets()
  const { data: budgetRange } = useBudget(startISO)
  // Anonymous visitors get no budget: the API is private and the hook stays idle.
  const budgetOf = (date: string) => budgetRange?.days.find((b) => b.date === date)?.budget ?? null

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => toISO(addDays(weekStart, i))), [weekStart])
  const recipeById = useMemo(() => new Map((recipes ?? []).map((r) => [r.id, r])), [recipes])
  const entries = useMemo(() => (plan?.entries ?? []).filter((e) => days.includes(e.date)), [plan, days])
  const letters = useMemo(() => cookLetters(entries), [entries])
  const slots = canEdit ? DIARY_SLOTS : SLOTS
  const at = (date: string, slot: Slot) => entries.filter((e) => e.date === date && e.slot === slot)
  const totalsOf = (date: string) => dayTotals(entries.filter((e) => e.date === date))
  const mealsPlanned = entries.filter((e) => e.slot !== 'snack').length

  // Pots visible this week: from the cook day (or the week's first portion) to the last portion.
  const pots = useMemo(() => {
    const byCook = new Map<string, PlanEntry[]>()
    for (const e of entries) if (e.cookId) byCook.set(e.cookId, [...(byCook.get(e.cookId) ?? []), e])
    return [...byCook.entries()].map(([cookId, list]) => {
      const sorted = list.sort((a, b) => a.date.localeCompare(b.date))
      const used = list.reduce((s, e) => s + e.portions, 0)
      return {
        cookId,
        letter: letters.get(cookId) ?? '?',
        title: entryTitle(sorted[0]),
        portions: sorted[0].cookPortions ?? 0,
        from: Math.max(0, days.indexOf(sorted[0].date)),
        to: days.indexOf(sorted[sorted.length - 1].date),
        left: Math.max(0, Math.floor((sorted[0].cookPortions ?? 0) - used)),
      }
    })
  }, [entries, letters, days])

  function goWeek(next: Date) {
    onWeek(next)
    setReviewItems(null)
    setShopMsg(null)
  }

  function onCell(date: string, slot: Slot, list: PlanEntry[]) {
    if (canEdit) {
      if (list.length === 1) openEntry(list[0])
      else if (list.length === 0) openAdd(date, slot)
      else onDay(date)
    } else if (list[0]?.recipeId) nav(`/recipe/${list[0].recipeId}`)
  }

  // Failures surface as the global mutation toast; here they only stop the flow.
  async function onAddMissing() {
    setShopMsg(null)
    try {
      const preview = await previewShopping.mutateAsync({ start: startISO, days: 7 })
      const uncertain = preview.items.filter((item) => item.needsConfirmation)
      if (uncertain.length > 0) {
        setReviewItems(uncertain)
        return
      }
      await commitShopping([])
    } catch {
      /* toast already shown */
    }
  }

  async function commitShopping(confirmations: PantryConfirmation[]) {
    let r
    try {
      r = await addMissing.mutateAsync({ start: startISO, days: 7, confirmations })
    } catch {
      return // toast already shown; the review stays open for another try
    }
    const parts = [
      r.added > 0 ? `dodano ${r.added}` : '',
      r.updated > 0 ? `zaktualizowano ${r.updated}` : '',
    ].filter(Boolean)
    const msg = parts.length > 0
      ? `Gotowe: ${parts.join(', ')} ${parts.length === 1 && r.added + r.updated === 1 ? 'pozycję' : 'pozycji'} na liście zakupów.`
      : 'Wszystko z tego tygodnia już masz (lub jest na liście).'
    setShopMsg(msg)
    // On a phone the message line sits far below the fold — the toast is what she sees.
    showToast(msg, parts.length > 0 ? { label: 'Pokaż listę', run: () => nav('/shopping') } : undefined)
    setReviewItems(null)
  }

  const busy = addMissing.isPending || previewShopping.isPending
  const first = parseISODate(days[0])
  const last = parseISODate(days[6])
  const leftoverNote = 'Resztki nie trafiają na listę zakupów. Składniki kupujesz raz, na dzień gotowania.'

  const reviewSheet = (
    <Sheet open={!!reviewItems} onClose={() => setReviewItems(null)} title="Sprawdź, co masz w domu" width={620}>
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
  )

  if (isMobile) {
    return (
      <div style={{ ...pad, paddingBottom: canEdit ? 150 : 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PageTitle title="Plan" right={switcher} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', font: mono(13, 500) }}>
          <button type="button" onClick={() => goWeek(mondayOf(new Date()))} style={{ ...arrowBtn, width: 'auto', font: mono(13, 500) }} title="Ten tydzień">
            {first.getDate()}–{last.getDate()} {MONTHS_SHORT[last.getMonth()]}
          </button>
          <span>
            <button type="button" aria-label="Poprzedni tydzień" onClick={() => goWeek(addDays(weekStart, -7))} style={arrowBtn}>‹</button>
            <button type="button" aria-label="Następny tydzień" onClick={() => goWeek(addDays(weekStart, 7))} style={arrowBtn}>›</button>
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', padding: '10px 0' }}>
          {days.map((d, i) => {
            const today = d === todayISO
            return (
              <button
                key={d}
                type="button"
                onClick={() => document.getElementById(`plan-day-${d}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 5, padding: '6px 4px', border: 0, borderRadius: 10, background: today ? 'var(--text)' : 'transparent', color: today ? 'var(--bg)' : 'var(--text)', cursor: 'pointer' }}
              >
                <span style={{ font: mono(10.5, 500), color: today ? 'var(--on-dark-muted)' : 'var(--text-3)' }}>{WEEKDAY_SHORT[i].slice(0, 2).toUpperCase()}</span>
                <span style={{ font: mono(16, 500) }}>{parseISODate(d).getDate()}</span>
                <WeekDayBar totals={totalsOf(d)} budget={budgetOf(d)} onDark={today} />
              </button>
            )
          })}
        </div>
        {days.map((d, i) => {
          const t = totalsOf(d)
          return (
            <div key={d} id={`plan-day-${d}`} style={{ display: 'flex', flexDirection: 'column', scrollMarginTop: 12 }}>
              <button
                type="button"
                onClick={() => canEdit && onDay(d)}
                style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '8px 0 6px', border: 0, background: 'transparent', cursor: canEdit ? 'pointer' : 'default', textAlign: 'left', color: 'var(--text)' }}
              >
                <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 24 }}>
                  {DAY_NAMES_PL[i]} <span style={{ fontStyle: 'italic', color: 'var(--text-3)' }}>{dayShortMonth(parseISODate(d))}</span>
                </span>
                <span style={{ font: mono(12), color: 'var(--text-2)' }}>{t.eaten + t.planned > 0 || budgetOf(d) != null ? dayLabel(t, budgetOf(d)) : ''}</span>
              </button>
              {slots.map((s) => {
                const list = at(d, s)
                const joined = s === 'snack' && list.length > 1
                const rows: PlanEntry[][] = list.length === 0 ? [[]] : joined ? [list] : list.map((e) => [e])
                // Przekąski pile up through the day: a filled snack slot keeps its own „+ Dodaj”.
                const more = canEdit && s === 'snack' && list.length > 0 && (
                  <button
                    key={`${s}-more`}
                    type="button"
                    onClick={() => openAdd(d, s)}
                    style={{ display: 'grid', gridTemplateColumns: '78px minmax(0, 1fr)', gap: 10, padding: '0 0 8px', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span />
                    <span style={{ font: sans(13.5, 600), color: 'var(--text-2)' }}>+ Dodaj przekąskę</span>
                  </button>
                )
                return [...rows.map((row, ri) => (
                  <button
                    key={`${s}-${ri}`}
                    type="button"
                    onClick={() => (joined ? (canEdit ? onDay(d) : undefined) : onCell(d, s, row))}
                    style={{ display: 'grid', gridTemplateColumns: '78px minmax(0, 1fr) auto', alignItems: row.length ? 'start' : 'center', gap: 10, padding: row.length || !canEdit ? '11px 0' : '7px 0', border: 0, borderTop: '1px solid var(--border)', background: 'transparent', cursor: canEdit || row[0]?.recipeId ? 'pointer' : 'default', textAlign: 'left', color: 'var(--text)' }}
                  >
                    <span style={{ font: mono(10.5, 500), letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)', paddingTop: row.length ? 3 : 0 }}>{ri === 0 ? slotLabel[s] : ''}</span>
                    {row.length > 0 ? (
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: sans(15), color: row.every((e) => e.eaten || !canEdit) ? 'var(--text)' : 'var(--text-2)' }}>
                          {row.length === 1 && row[0].cookId && <CookMark letter={letters.get(row[0].cookId) ?? '?'} filled={!row[0].isLeftover} />}
                          {row.map(entryTitle).join(' · ')}
                          {row.length === 1 && row[0].cooked && <span title="Ugotowane — jest wpis w historii" style={{ color: 'var(--sage)', fontWeight: 600 }}>✓</span>}
                        </span>
                        {row.length === 1 && row[0].cookId && (
                          <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 13.5, color: 'var(--text-2)' }}>
                            {row[0].isLeftover ? leftoverLabel(row[0]) : `gotuję ${row[0].cookPortions} porcje`}
                          </span>
                        )}
                      </span>
                    ) : canEdit ? (
                      <span style={{ height: 34, border: '1px dashed var(--border-2)', borderRadius: 9, display: 'flex', alignItems: 'center', padding: '0 12px', font: sans(14, 500), color: 'var(--text-2)' }}>+ Dodaj</span>
                    ) : (
                      <span style={{ color: 'var(--text-3)' }}>—</span>
                    )}
                    <span style={{ font: mono(12.5, 500), color: row.every((e) => e.eaten) ? 'var(--text)' : 'var(--text-3)', paddingTop: 2 }}>
                      {kcalText(dayTotals(row))}
                    </span>
                  </button>
                )), more]
              })}
            </div>
          )
        })}
        <span style={{ font: sans(13.5), lineHeight: 1.5, color: 'var(--text-2)' }}>{shopMsg ?? leftoverNote}</span>
        {canEdit && (
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`, zIndex: 20, padding: '12px 16px 10px', background: 'var(--bg)', boxShadow: '0 -1px 0 var(--border)' }}>
            <Button size="xl" style={{ width: '100%' }} onClick={onAddMissing} disabled={busy}>
              {busy ? 'Sprawdzam…' : 'Dodaj brakujące składniki do zakupów'}
            </Button>
          </div>
        )}
        {reviewSheet}
        {sheets}
      </div>
    )
  }

  const gridCols = '96px repeat(7, minmax(0, 1fr))'
  return (
    <div style={{ ...pad, maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <PageTitle
        title="Plan"
        sub={
          <>
            {first.getDate()}–{dayShortMonth(last)}. {canEdit ? 'Kropka pełna = zjedzone, przerywana = plan. Literą oznaczone jedno gotowanie i jego resztki.' : 'Plan tygodnia.'}
          </>
        }
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {switcher}
            <Button variant="quiet" size="sm" onClick={() => goWeek(addDays(weekStart, -7))}>‹ Poprzedni</Button>
            <Button variant="dark" size="sm" onClick={() => goWeek(mondayOf(new Date()))}>Dziś</Button>
            <Button variant="quiet" size="sm" onClick={() => goWeek(addDays(weekStart, 7))}>Następny ›</Button>
          </div>
        }
      />

      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, borderTop: '1px solid var(--rule)', minWidth: 760 }}>
          <span />
          {days.map((d, i) => {
            const today = d === todayISO
            const t = totalsOf(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() => canEdit && onDay(d)}
                style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 12px', border: 0, borderLeft: today ? 0 : '1px solid var(--border)', background: today ? 'var(--text)' : 'transparent', color: today ? 'var(--bg)' : 'var(--text)', cursor: canEdit ? 'pointer' : 'default', textAlign: 'left', minWidth: 0 }}
              >
                <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 20 }}>
                  {WEEKDAY_SHORT[i]} <span style={{ fontStyle: 'italic', color: today ? 'var(--on-dark-muted)' : 'var(--text-3)' }}>{parseISODate(d).getDate()}</span>
                </span>
                <WeekDayBar totals={t} budget={budgetOf(d)} onDark={today} />
                <span style={{ font: mono(11), color: today ? 'var(--on-dark-muted)' : 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {dayLabel(t, budgetOf(d))}
                </span>
              </button>
            )
          })}

          {slots.map((s, row) => {
            const top = row === 0 ? '1px solid var(--rule)' : '1px solid var(--border)'
            return [
              <span key={s} style={{ padding: '16px 0', borderTop: top, font: mono(10.5, 500), letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                {slotLabel[s]}
              </span>,
              ...days.map((d) => {
                const list = at(d, s)
                const today = d === todayISO
                const cell: CSSProperties = {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  minHeight: s === 'snack' ? 92 : 104,
                  padding: list.length ? '12px 12px' : 10,
                  borderTop: top,
                  borderLeft: today ? 0 : '1px solid var(--border)',
                  background: today ? 'var(--surface)' : 'transparent',
                  minWidth: 0,
                }
                return (
                  <div key={`${s}-${d}`} style={cell}>
                    {list.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onCell(d, s, [e])}
                        style={{ display: 'grid', gridTemplateColumns: canEdit ? '10px minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 7, padding: 0, border: 0, background: 'transparent', cursor: canEdit || e.recipeId ? 'pointer' : 'default', textAlign: 'left', color: 'var(--text)' }}
                      >
                        {canEdit && (
                          <span style={{ width: 7, height: 7, marginTop: 6, borderRadius: '50%', boxSizing: 'border-box', background: e.eaten ? 'var(--sage)' : 'transparent', border: e.eaten ? 0 : '1px dashed var(--text-3)' }} />
                        )}
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                          {recipeById.get(e.recipeId ?? '')?.sourceName && !canEdit && <Eyebrow size={10}>{recipeById.get(e.recipeId!)!.sourceName}</Eyebrow>}
                          <span style={{ font: sans(14.5), lineHeight: 1.35, color: e.eaten || !canEdit ? 'var(--text)' : 'var(--text-2)' }}>
                            {entryTitle(e)}
                            {e.cooked && <span title="Ugotowane — jest wpis w historii" style={{ marginLeft: 6, color: 'var(--sage)', fontWeight: 600 }}>✓</span>}
                          </span>
                          {e.cookId && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <CookMark letter={letters.get(e.cookId) ?? '?'} filled={!e.isLeftover} />
                              <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 13.5, color: 'var(--text-2)' }}>
                                {e.isLeftover ? 'resztki' : `gotuję ×${e.cookPortions}`}
                              </span>
                            </span>
                          )}
                          {e.kcalMissing ? (
                            <span style={{ font: mono(10.5, 500), color: 'var(--gold-text)' }}>brak kcal</span>
                          ) : (
                            e.kcal != null && <span style={{ font: mono(11.5), color: 'var(--text-3)' }}>{e.eaten ? '' : '~'}{formatKcal(e.kcal)}</span>
                          )}
                        </span>
                      </button>
                    ))}
                    {list.length === 0 && canEdit && (
                      <button type="button" onClick={() => openAdd(d, s)} aria-label={`Dodaj: ${slotLabel[s]}`} style={{ flex: 1, minHeight: 64, border: '1px dashed var(--border-2)', borderRadius: 10, background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--text-3)' }}>+</button>
                    )}
                    {list.length > 0 && canEdit && (
                      <button type="button" onClick={() => openAdd(d, s)} aria-label={`Dodaj kolejne: ${slotLabel[s]}`} style={{ alignSelf: 'flex-start', height: 24, padding: '0 10px', border: '1px dashed var(--border-2)', borderRadius: 999, background: 'transparent', cursor: 'pointer', font: sans(13, 500), color: 'var(--text-3)' }}>+</button>
                    )}
                  </div>
                )
              }),
            ]
          })}

          {canEdit && pots.length > 0 && (
            <>
              <span style={{ padding: '14px 0', borderTop: '1px solid var(--rule)', font: mono(10.5, 500), letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)', gridRow: `span ${pots.length}` }}>
                W lodówce
              </span>
              {pots.map((p, i) => (
                <div key={p.cookId} style={{ gridColumn: `${p.from + 2} / ${p.to + 3}`, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: i === 0 ? '1px solid var(--rule)' : 0, minWidth: 0 }}>
                  <CookMark letter={p.letter} filled />
                  <span style={{ font: mono(11.5, 500), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title} · {p.portions} porcje</span>
                  <span style={{ flex: 1, minWidth: 16, height: 1.5, background: 'var(--text)' }} />
                  <span style={{ font: mono(11.5), color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{p.left > 0 ? `zostaje ${p.left}` : 'bez reszty'}</span>
                  <CookMark letter={p.letter} filled={false} />
                </div>
              ))}
            </>
          )}
          <span style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--rule)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, font: sans(14.5), color: 'var(--text-2)' }}>
          <span>{shopMsg ?? `${mealsPlanned} z 21 posiłków zaplanowanych`}</span>
          {pots.length > 0 && <span style={{ font: sans(13.5), color: 'var(--text-3)' }}>{leftoverNote}</span>}
        </span>
        {canEdit && (
          <Button size="lg" onClick={onAddMissing} disabled={busy}>
            {busy ? 'Sprawdzam…' : 'Dodaj brakujące składniki z tego tygodnia do zakupów'}
          </Button>
        )}
      </div>
      {reviewSheet}
      {sheets}
    </div>
  )
}

/** Eaten kcal; the „~” planned estimate only when nothing is eaten yet. */
function kcalText(t: DayTotals): string {
  if (t.eaten > 0) return formatKcal(t.eaten)
  return t.planned > 0 ? `~${formatKcal(t.planned)}` : ''
}

const arrowBtn: CSSProperties = { width: 32, height: 36, border: 0, background: 'transparent', cursor: 'pointer', font: sans(16, 600), color: 'var(--text)' }

type Answer = { kind: 'have' | 'none' | 'other'; draft: string }

/** The quantity an answer confirms; null = no (valid) answer yet. */
function answeredQuantity(item: PantryItem, a: Answer | undefined): number | null {
  if (!a) return null
  if (a.kind === 'have') return item.quantity
  if (a.kind === 'none') return 0
  const value = Number(a.draft.replace(',', '.'))
  return a.draft.trim() !== '' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * "Sprawdź, co masz w domu" — asked before adding the week to the list, only for pantry
 * items whose stock is uncertain (not checked for a while, or partly used by cooking)
 * AND where that uncertainty changes what gets bought. Each answer also corrects the
 * pantry (the API confirms it as checked stock); skipping one buys the safe amount.
 */
function ShoppingReview({ items, pantry, pending, onCancel, onCommit }: {
  items: ShoppingPreviewItem[]
  pantry: PantryItem[]
  pending: boolean
  onCancel: () => void
  onCommit: (confirmations: PantryConfirmation[]) => Promise<void>
}) {
  const isMobile = useIsMobile()
  const byId = new Map(pantry.map((item) => [item.id, item]))
  const optionsOf = (preview: ShoppingPreviewItem) =>
    (preview.pantryItemId ? [preview.pantryItemId] : preview.alternativePantryItemIds ?? [])
      .map((id) => byId.get(id))
      .filter((p): p is PantryItem => !!p)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const answer = (id: string, a: Answer) => setAnswers((current) => ({ ...current, [id]: a }))

  const confirmations = Object.entries(answers).flatMap(([pantryItemId, a]) => {
    const item = byId.get(pantryItemId)
    const quantity = item ? answeredQuantity(item, a) : null
    return quantity == null ? [] : [{ pantryItemId, quantity }]
  })
  const answered = new Set(confirmations.map((c) => c.pantryItemId))
  const askedCount = new Set(items.flatMap((i) => optionsOf(i).map((o) => o.id))).size

  /** What this product adds to the list, given the answers so far. */
  function outcome(preview: ShoppingPreviewItem, options: PantryItem[]): string {
    const known = options.map((o) => answeredQuantity(o, answers[o.id]))
    if (options.length === 1 && preview.requiredQuantity != null && preview.unit) {
      const stock = known[0]
      const buy = stock != null
        ? Math.max(0, preview.requiredQuantity - stock)
        : preview.suggestedPurchase ?? preview.requiredQuantity
      const what = buy > 0 ? `kupimy ${formatQty(buy, preview.unit)}` : 'nic nie kupujemy'
      return stock != null ? `→ ${what}` : `Bez odpowiedzi ${what} (na zapas).`
    }
    if (known.some((q) => q != null && q > 0)) return '→ nic nie kupujemy'
    if (known.length > 0 && known.every((q) => q === 0)) return '→ dopiszemy do listy'
    return 'Bez odpowiedzi dopiszemy do listy (na zapas).'
  }

  const choice = (on: boolean): CSSProperties => ({
    flex: 1,
    minWidth: 0,
    height: 40,
    padding: '0 8px',
    borderRadius: 10,
    border: on ? '1px solid var(--text)' : '1px solid var(--border)',
    background: on ? 'var(--text)' : 'transparent',
    color: on ? 'var(--bg)' : 'var(--text)',
    font: sans(13.5, 600),
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ font: sans(14), lineHeight: 1.5, color: 'var(--text-2)' }}>
        Te produkty są w spiżarni, ale nie wiemy na pewno, ile ich zostało — dawno ich nie sprawdzaliście
        albo część poszła na gotowanie. Zajrzyj do szafki: kupimy tylko tyle, ile brakuje.
        Pominięte kupimy na zapas.{' '}
        <b style={{ fontWeight: 600, color: 'var(--text)' }}>Odpowiedzi poprawią też stan spiżarni.</b>
      </span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((preview) => {
          const options = optionsOf(preview)
          const need = preview.requiredQuantity != null && preview.unit ? formatQty(preview.requiredQuantity, preview.unit) : null
          const settled = options.some((o) => answered.has(o.id))
          return (
            <div key={preview.key} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ font: sans(16, 600), minWidth: 0 }}>{preview.name}</span>
                  {need && <span style={{ flex: 'none', font: mono(12.5), color: 'var(--text-2)' }}>potrzeba {need}</span>}
                </span>
                <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>
                  {options.length > 1 ? 'Wystarczy jedno z nich · ' : ''}do: {preview.sources.join(', ')}
                </span>
              </div>
              {options.map((item) => {
                const a = answers[item.id]
                return (
                  <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ font: sans(14) }}>
                      {options.length > 1 && <b style={{ fontWeight: 600 }}>{item.name}: </b>}
                      w spiżarni zapisane ~{formatQty(item.quantity, item.unit)}. Ile masz?
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" style={choice(a?.kind === 'have')} onClick={() => answer(item.id, { kind: 'have', draft: '' })}>
                        Tyle mam
                      </button>
                      <button type="button" style={choice(a?.kind === 'none')} onClick={() => answer(item.id, { kind: 'none', draft: '' })}>
                        Nie mam
                      </button>
                      <button type="button" style={choice(a?.kind === 'other')} onClick={() => answer(item.id, { kind: 'other', draft: a?.draft ?? '' })}>
                        Inna ilość
                      </button>
                    </div>
                    {a?.kind === 'other' && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: sans(14), color: 'var(--text-2)' }}>
                        Mam
                        <input
                          autoFocus
                          value={a.draft}
                          onChange={(e) => answer(item.id, { kind: 'other', draft: e.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                          style={{ ...inputStyle, width: 96, height: 40, padding: '0 10px', font: mono(14), textAlign: 'right' }}
                        />
                        {unitLabel[item.unit]}
                      </label>
                    )}
                  </div>
                )
              })}
              <span style={{ font: sans(13, settled ? 600 : 400), color: settled ? 'var(--text)' : 'var(--text-3)' }}>
                {outcome(preview, options)}
              </span>
            </div>
          )
        })}
      </div>
      {/* Pinned to the sheet's bottom edge: the negative offsets cancel the Sheet's own padding. */}
      <div style={{ position: 'sticky', bottom: isMobile ? 'calc(-20px - env(safe-area-inset-bottom))' : -26, display: 'flex', flexDirection: 'column', gap: 8, margin: isMobile ? '0 -20px' : '0 -26px', padding: isMobile ? '12px 20px calc(20px + env(safe-area-inset-bottom))' : '12px 26px 26px', background: 'var(--bg)', borderTop: '1px solid var(--rule)' }}>
        <span style={{ font: mono(12), color: 'var(--text-3)' }}>
          Odpowiedzi: {answered.size} z {askedCount} · możesz pominąć
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size={isMobile ? 'xl' : 'lg'} style={{ flex: 1 }} disabled={pending} onClick={() => onCommit(confirmations)}>
            {pending ? 'Dodaję…' : 'Dodaj do zakupów'}
          </Button>
          <Button size={isMobile ? 'xl' : 'lg'} variant="quiet" onClick={onCancel}>Anuluj</Button>
        </div>
      </div>
    </div>
  )
}
