import type { CSSProperties, ReactNode } from 'react'
import type { PlanEntry, RecipeListItem } from '../../api/client'
import { useFeminine } from '../../api/hooks'
import { formatGrams, formatKcal, formatPortion } from '../../lib/labels'
import { useIsMobile } from '../../lib/useIsMobile'
import { RecipeThumb } from '../RecipeThumb'
import { Eyebrow, mono, sans } from '../ui'

/** Day totals for meters. Planned = not eaten yet (only counted where the day isn't over). */
export interface DayTotals {
  eaten: number
  planned: number
  protein: number
  /** Some entry has no kcal estimate — totals are approximate ("~"). */
  missing: boolean
}

export function dayTotals(entries: PlanEntry[]): DayTotals {
  const t: DayTotals = { eaten: 0, planned: 0, protein: 0, missing: false }
  for (const e of entries) {
    if (e.kcalMissing) t.missing = true
    if (e.eaten) {
      t.eaten += e.kcal ?? 0
      t.protein += e.protein ?? 0
    } else {
      t.planned += e.kcal ?? 0
    }
  }
  return t
}

/** 17 px circle with the pot's letter: filled ink = cook day, outline = a leftover portion. */
export function CookMark({ letter, filled, size = 17, onDark }: { letter: string; filled: boolean; size?: number; onDark?: boolean }) {
  const ink = onDark ? 'var(--bg)' : 'var(--text)'
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: mono(size * 0.56, 600),
        background: filled ? ink : 'transparent',
        color: filled ? (onDark ? 'var(--text)' : 'var(--bg)') : ink,
        boxShadow: filled ? undefined : `inset 0 0 0 1px ${ink}`,
      }}
    >
      {letter}
    </span>
  )
}

/** Pot portions as dots: ink = still in the fridge, ring = used up. */
export function PortionDots({ total, left }: { total: number; left: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{ width: 7, height: 7, borderRadius: '50%', boxSizing: 'border-box', background: i < left ? 'var(--text)' : 'transparent', border: i < left ? 0 : '1px solid var(--border-2)' }}
        />
      ))}
    </span>
  )
}

export function KcalMissingTag() {
  return (
    <span style={{ font: mono(11, 500), color: 'var(--gold-text)', border: '1px solid var(--gold)', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>
      brak kcal
    </span>
  )
}

/** "z opaski" (sage dot) / "ręcznie" (ring). */
export function SourceTag({ band }: { band: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: mono(10.5, 500), color: band ? 'var(--sage-text)' : 'var(--text-3)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', boxSizing: 'border-box', background: band ? 'var(--sage)' : 'transparent', border: band ? 0 : '1px solid var(--text-3)' }} />
      {band ? 'z opaski' : 'ręcznie'}
    </span>
  )
}

/**
 * The bar shared by BudgetMeter and WeekDayBar: eaten ink, planned hatched, overflow gold.
 * Scale = max(budget, eaten + planned); without a budget it is just the day's food.
 */
function MeterBar({ eaten, planned, budget, height, onDark, base }: {
  eaten: number
  planned: number
  budget: number | null
  height: number
  onDark?: boolean
  /** Base target (before activity) — a 1 px tick. */
  base?: number | null
}) {
  const scale = Math.max(budget ?? 0, eaten + planned, 1)
  const pct = (n: number) => `${(Math.max(0, n) / scale) * 100}%`
  const within = budget == null ? eaten : Math.min(eaten, budget)
  const over = budget == null ? 0 : Math.max(0, eaten - budget)
  const plannedShown = budget == null ? planned : Math.max(0, Math.min(planned, scale - eaten))
  const ink = onDark ? 'var(--bg)' : 'var(--text)'
  return (
    <div
      style={{
        position: 'relative',
        height,
        display: 'flex',
        background: onDark ? '#4a3e32' : 'var(--surface)',
        boxShadow: height > 6 ? `inset 0 0 0 1px ${onDark ? 'var(--bg)' : 'var(--rule)'}` : undefined,
        overflow: 'hidden',
      }}
    >
      <span style={{ width: pct(within), background: ink }} />
      {over > 0 && <span style={{ width: pct(over), background: 'var(--gold)', borderLeft: '2px solid var(--bg)' }} />}
      {plannedShown > 0 && <span style={{ width: pct(plannedShown), background: onDark ? 'var(--hatch-on-dark)' : 'var(--hatch)', opacity: 0.55 }} />}
      {base != null && budget != null && base < scale && base !== budget && (
        <span style={{ position: 'absolute', left: pct(base), top: 0, bottom: 0, width: 1, background: 'var(--text-3)' }} />
      )}
    </div>
  )
}

/** 4 px day bar for the week strip/grid. Under ≤ 95 %, around 95–105 %, over > 105 %. */
export function WeekDayBar({ totals, budget, onDark }: { totals: DayTotals; budget: number | null; onDark?: boolean }) {
  return <MeterBar eaten={totals.eaten} planned={totals.planned} budget={budget} height={4} onDark={onDark} />
}

export function budgetState(eaten: number, budget: number | null): 'under' | 'around' | 'over' | null {
  if (budget == null || budget <= 0) return null
  const r = eaten / budget
  return r > 1.05 ? 'over' : r >= 0.95 ? 'around' : 'under'
}

/**
 * Day budget: big remaining number, eaten/planned/budget column, the bar, how the budget is
 * built and the protein line. Mode "plan" (future day) shows the planned total instead.
 * Without a target (not set yet) it just shows what was eaten.
 */
export function BudgetMeter({ totals, target, activityBonus = 0, proteinTarget, mode, footer }: {
  totals: DayTotals
  target: number | null
  activityBonus?: number
  proteinTarget?: number | null
  mode: 'day' | 'plan'
  footer?: ReactNode
}) {
  const isMobile = useIsMobile()
  const ate = useFeminine() ? 'Zjadłaś' : 'Zjadłeś'
  const budget = target == null ? null : target + activityBonus
  const approx = totals.missing ? '~' : ''
  const plannedApprox = '~'
  let eyebrow: ReactNode
  let big: string
  if (mode === 'plan') {
    eyebrow = 'W planie'
    big = `${plannedApprox}${formatKcal(totals.planned + totals.eaten)}`
  } else if (budget == null) {
    eyebrow = ate
    big = `${approx}${formatKcal(totals.eaten)}`
  } else if (totals.eaten > budget) {
    eyebrow = <span style={{ color: 'var(--gold-text)' }}>Ponad budżet</span>
    big = formatKcal(totals.eaten - budget)
  } else {
    eyebrow = 'Zostało'
    big = `${approx}${formatKcal(budget - totals.eaten)}`
  }

  const rows: [string, string][] = []
  if (mode === 'day' && (budget != null || totals.planned > 0)) rows.push([ate.toLowerCase(), `${approx}${formatKcal(totals.eaten)}`])
  if (totals.planned > 0 && (mode === 'day' || totals.eaten > 0)) rows.push(['w planie', `~${formatKcal(totals.planned)}`])
  if (budget != null) rows.push(['budżet', formatKcal(budget)])

  const line: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, font: mono(12.5), color: 'var(--text-2)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ font: mono(isMobile ? (big.length > 4 ? 44 : 52) : 64, 500), letterSpacing: '-0.04em', lineHeight: 1, whiteSpace: 'nowrap' }}>{big}</span>
            <span style={{ font: mono(isMobile ? 14 : 16), color: 'var(--text-3)' }}>kcal</span>
          </span>
        </div>
        {rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: isMobile ? 150 : 190, paddingBottom: 4 }}>
            {rows.map(([k, v]) => (
              <span key={k} style={line}><span>{k}</span><span style={{ color: 'var(--text)' }}>{v}</span></span>
            ))}
          </div>
        )}
      </div>
      <MeterBar eaten={totals.eaten} planned={totals.planned} budget={budget} height={isMobile ? 12 : 16} base={target} />
      {target != null ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, font: mono(12), color: 'var(--text-3)' }}>
          <span>{formatKcal(target)} cel + {formatKcal(activityBonus)} aktywność</span>
          <span>= {formatKcal(budget!)} budżet</span>
        </div>
      ) : (
        footer
      )}
      {mode === 'day' && proteinTarget != null && proteinTarget > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <Eyebrow>Białko</Eyebrow>
          <span style={{ flex: 1, height: 4, background: 'var(--border)', position: 'relative' }}>
            <span style={{ position: 'absolute', inset: 0, width: `${Math.min(100, (totals.protein / proteinTarget) * 100)}%`, background: 'var(--accent)' }} />
          </span>
          <span style={{ font: mono(12.5, 500) }}>B {Math.round(totals.protein)} / {Math.round(proteinTarget)} g</span>
        </div>
      )}
    </div>
  )
}

/** Day name in the genitive-ish form the design uses: „resztki z poniedziałku”. */
const FROM_DAY = ['niedzieli', 'poniedziałku', 'wtorku', 'środy', 'czwartku', 'piątku', 'soboty']
export function leftoverLabel(e: PlanEntry): string {
  if (!e.cookDate) return 'resztki'
  if (e.cookDate === e.date) return 'z garnka'
  const [y, m, d] = e.cookDate.split('-').map(Number)
  return `resztki z ${FROM_DAY[new Date(y, m - 1, d).getDay()]}`
}

export function entryTitle(e: PlanEntry): string {
  return e.recipeTitle ?? e.title
}

/**
 * One diary row: status disc, thumb (recipes), title + meta, kcal. Planned rows get a
 * „✓ Zjedzone” pill. `letter` is the pot's CookMark letter within the visible week.
 */
export function DiaryItem({ entry, recipe, letter, onToggleEaten, onOpen, canEdit, busy }: {
  entry: PlanEntry
  recipe?: RecipeListItem
  letter?: string
  onToggleEaten?: () => void
  onOpen?: () => void
  canEdit: boolean
  busy?: boolean
}) {
  const isMobile = useIsMobile()
  const thumb = entry.recipeId != null
  const eaten = entry.eaten
  const meta: ReactNode[] = []
  if (entry.grams != null) meta.push(<span key="g" style={{ font: mono(12), color: 'var(--text-3)' }}>{formatGrams(entry.grams)}</span>)
  else if (entry.recipeId && entry.portions !== 1) meta.push(<span key="p" style={{ font: mono(12), color: 'var(--text-3)' }}>{formatPortion(entry.portions)}</span>)
  if (entry.cookId && letter) {
    meta.push(
      <span key="c" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <CookMark letter={letter} filled={!entry.isLeftover} />
        <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--text-2)' }}>
          {entry.isLeftover ? leftoverLabel(entry) : `gotuję ×${entry.cookPortions ?? ''}`}
        </span>
      </span>,
    )
  }
  if (!eaten && meta.length === 0) meta.push(<span key="w" style={{ font: sans(13), color: 'var(--text-3)' }}>w planie</span>)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `22px ${thumb ? `${isMobile ? 44 : 52}px ` : ''}minmax(0, 1fr) auto`,
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderTop: '1px solid var(--border)',
      }}
    >
      <button
        type="button"
        disabled={!canEdit || busy}
        onClick={onToggleEaten}
        aria-label={eaten ? 'Cofnij: niezjedzone' : 'Oznacz jako zjedzone'}
        style={{
          width: 22,
          height: 22,
          padding: 0,
          borderRadius: '50%',
          border: eaten ? 0 : '1.5px dashed var(--border-2)',
          background: eaten ? 'var(--sage)' : 'transparent',
          color: '#fff',
          font: sans(12, 700),
          cursor: canEdit ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {eaten ? '✓' : ''}
      </button>
      {thumb && (
        <button type="button" onClick={onOpen} style={{ padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }} tabIndex={-1}>
          <RecipeThumb r={recipe ?? { title: entryTitle(entry), tint: '#c0552d', imageUrl: null }} letterSize={16} style={{ width: isMobile ? 44 : 52, height: isMobile ? 44 : 52, borderRadius: 10 }} />
        </button>
      )}
      <button
        type="button"
        onClick={onOpen}
        style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, padding: 0, border: 0, background: 'transparent', cursor: onOpen ? 'pointer' : 'default', textAlign: 'left', color: eaten ? 'var(--text)' : 'var(--text-2)' }}
      >
        <span style={{ font: sans(16, 500), lineHeight: 1.3 }}>{entryTitle(entry)}</span>
        {meta.length > 0 && <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 }}>{meta}</span>}
      </button>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {entry.kcalMissing ? (
          <KcalMissingTag />
        ) : (
          <span style={{ font: mono(13.5, 500), color: eaten ? 'var(--text)' : 'var(--text-3)' }}>
            {eaten ? '' : '~'}{formatKcal(entry.kcal ?? 0)}
          </span>
        )}
        {!eaten && canEdit && onToggleEaten && (
          <button
            type="button"
            onClick={onToggleEaten}
            disabled={busy}
            style={{ height: 36, padding: '0 12px', borderRadius: 999, border: '1px solid var(--rule)', background: 'transparent', font: sans(13.5, 600), color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            ✓ Zjedzone
          </button>
        )}
      </span>
    </div>
  )
}

/** Pot letters A, B, C… assigned per cook in date order within the visible range. */
export function cookLetters(entries: PlanEntry[]): Map<string, string> {
  const firsts = new Map<string, string>()
  for (const e of [...entries].sort((a, b) => (a.cookDate ?? a.date).localeCompare(b.cookDate ?? b.date))) {
    if (e.cookId && !firsts.has(e.cookId)) firsts.set(e.cookId, String.fromCharCode(65 + (firsts.size % 26)))
  }
  return firsts
}
