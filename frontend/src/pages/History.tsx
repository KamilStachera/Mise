import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCookLog, useRecipes } from '../api/hooks'
import type { CookLogEntry, RecipeListItem } from '../api/client'
import { gradient } from '../lib/colors'
import { cuisineLabel, plural } from '../lib/labels'
import { parseISODate } from '../lib/dates'
import { HistoryIcon } from '../components/icons'

type Filter = 'all' | 'high'

/** An entry joined with its recipe (if still alive) and its 1-based repeat count. */
type Enriched = {
  entry: CookLogEntry
  recipe: RecipeListItem | undefined
  occurrence: number
  date: Date
}

const HIGH_RATING = 4

function mondayOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
}

/** The word without its number: pluralWord(3, 'wpis', …) → "wpisy". */
function pluralWord(n: number, one: string, few: string, many: string): string {
  return plural(n, one, few, many).replace(/^\S+ /, '')
}

function groupLabel(date: Date, now: Date): string {
  const diff = Math.round((mondayOf(now).getTime() - mondayOf(date).getTime()) / 86_400_000)
  if (diff <= 0) return 'W tym tygodniu'
  if (diff <= 7) return 'W zeszłym tygodniu'
  const month = date.toLocaleDateString('pl-PL', { month: 'long' })
  const capped = month[0].toUpperCase() + month.slice(1)
  return date.getFullYear() === now.getFullYear() ? capped : `${capped} ${date.getFullYear()}`
}

const capStyle: CSSProperties = {
  font: "700 11px 'Hanken Grotesk'",
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
}

function segBtn(on: boolean): CSSProperties {
  return {
    border: 'none',
    borderRadius: 8,
    padding: '7px 14px',
    font: "600 12.5px 'Hanken Grotesk'",
    cursor: 'pointer',
    background: on ? 'var(--card)' : 'transparent',
    color: on ? 'var(--accent-deep)' : 'var(--text-2)',
    boxShadow: on ? '0 1px 4px rgba(80,60,30,.14)' : 'none',
    transition: 'all .13s',
    whiteSpace: 'nowrap',
  }
}

export function History() {
  const nav = useNavigate()
  const { data: entries = [], isLoading } = useCookLog(undefined, 500)
  const { data: recipes = [] } = useRecipes('all', '')
  const [filter, setFilter] = useState<Filter>('all')

  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes])

  // The server returns newest-first; walking backwards is chronological, which
  // lets each entry get its "n-th time this recipe was cooked" in one pass.
  const enriched = useMemo<Enriched[]>(() => {
    const nth = new Map<string, number>()
    const occurrence = new Map<string, number>()
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (!e.recipeId) continue
      const n = (nth.get(e.recipeId) ?? 0) + 1
      nth.set(e.recipeId, n)
      occurrence.set(e.id, n)
    }
    return entries.map((e) => ({
      entry: e,
      recipe: e.recipeId ? recipeById.get(e.recipeId) : undefined,
      occurrence: occurrence.get(e.id) ?? 1,
      date: parseISODate(e.cookedAt),
    }))
  }, [entries, recipeById])

  const stats = useMemo(() => {
    const now = new Date()
    const thisMonth = enriched.filter(
      (x) => x.date.getFullYear() === now.getFullYear() && x.date.getMonth() === now.getMonth(),
    ).length
    const highCount = entries.filter((e) => e.rating !== null && e.rating >= HIGH_RATING).length

    // Streak = consecutive weeks (Monday-based) with at least one cook, counted
    // back from the current week; an empty current week doesn't break it yet.
    const weeks = new Set(enriched.map((x) => mondayOf(x.date).getTime()))
    let cursor = mondayOf(now)
    if (!weeks.has(cursor.getTime())) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7)
    }
    let streak = 0
    while (weeks.has(cursor.getTime())) {
      streak++
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7)
    }

    const dishCounts = new Map<string, { title: string; count: number }>()
    for (const x of enriched) {
      const key = x.entry.recipeId ?? `dish:${x.entry.dishName.toLowerCase()}`
      const cur = dishCounts.get(key)
      if (cur) cur.count++
      else dishCounts.set(key, { title: x.recipe?.title ?? x.entry.dishName, count: 1 })
    }
    const topDish = [...dishCounts.values()].sort((a, b) => b.count - a.count)[0] ?? null

    const cuisineCounts = new Map<string, number>()
    for (const x of enriched) {
      if (x.recipe?.cuisine) cuisineCounts.set(x.recipe.cuisine, (cuisineCounts.get(x.recipe.cuisine) ?? 0) + 1)
    }
    const topCuisine = [...cuisineCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null

    return { thisMonth, highCount, streak, topDish, topCuisine }
  }, [enriched, entries])

  const filtered = useMemo(
    () => (filter === 'all' ? enriched : enriched.filter((x) => x.entry.rating !== null && x.entry.rating >= HIGH_RATING)),
    [enriched, filter],
  )

  const groups = useMemo(() => {
    const now = new Date()
    const out: { label: string; items: Enriched[] }[] = []
    for (const x of filtered) {
      const label = groupLabel(x.date, now)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(x)
      else out.push({ label, items: [x] })
    }
    return out
  }, [filtered])

  if (isLoading) {
    return <div style={{ padding: 40, color: 'var(--text-3)', maxWidth: 720, margin: '0 auto' }}>Ładowanie…</div>
  }

  const total = entries.length
  const summary =
    total === 0
      ? 'Każdy ugotowany posiłek zapisuje się tutaj — z oceną i notatką.'
      : `Razem ${plural(total, 'ugotowany posiłek', 'ugotowane posiłki', 'ugotowanych posiłków')}.` +
        (stats.topDish && stats.topDish.count > 1 ? ` Najczęściej na stole: ${stats.topDish.title} (${stats.topDish.count}×).` : '')

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '38px 42px 60px' }}>
      <div style={{ font: "600 11px 'Hanken Grotesk'", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 7 }}>
        Dziennik kuchenny
      </div>
      <h1 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 38, lineHeight: 1.05, margin: '0 0 5px', color: 'var(--text)' }}>
        Historia gotowania
      </h1>
      <p style={{ fontSize: 14.5, color: 'var(--text-2)', margin: '0 0 22px' }}>{summary}</p>

      {total === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, textAlign: 'center', padding: '52px 24px', border: '1.5px dashed var(--border-2)', borderRadius: 18, background: 'var(--surface)' }}>
          <div style={{ width: 58, height: 58, borderRadius: 16, background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
            <HistoryIcon size={27} style={{ color: 'var(--accent)' }} />
          </div>
          <div style={{ fontFamily: "'Spectral', serif", fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>Historia jest jeszcze pusta</div>
          <div style={{ fontSize: 13.5, color: 'var(--text-2)', maxWidth: '42ch' }}>
            Ugotuj coś i kliknij „Ugotowane!” na stronie przepisu — każdy posiłek zapisze się tutaj.
          </div>
          <button
            onClick={() => nav('/')}
            style={{ marginTop: 10, border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '9px 16px', font: "600 13px 'Hanken Grotesk'", cursor: 'pointer' }}
          >
            Przeglądaj przepisy
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 22 }}>
            <StatTile cap="W tym miesiącu" value={String(stats.thisMonth)} sub={pluralWord(stats.thisMonth, 'posiłek', 'posiłki', 'posiłków')} />
            <StatTile cap="Seria" value={stats.streak > 0 ? String(stats.streak) : '—'} sub={stats.streak > 0 ? `${pluralWord(stats.streak, 'tydzień', 'tygodnie', 'tygodni')} z rzędu` : 'brak serii'} />
            <StatTile cap="Najczęściej" value={stats.topDish?.title ?? '—'} sub={stats.topDish ? `${stats.topDish.count}×` : ''} small />
            <StatTile cap="Ulubiona kuchnia" value={stats.topCuisine ? capitalize(cuisineLabel[stats.topCuisine[0] as keyof typeof cuisineLabel]) : '—'} sub={stats.topCuisine ? plural(stats.topCuisine[1], 'danie', 'dania', 'dań') : ''} small />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 22 }}>
            <div style={{ display: 'flex', gap: 3, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: 3 }}>
              <button onClick={() => setFilter('all')} style={segBtn(filter === 'all')}>Wszystko</button>
              <button onClick={() => setFilter('high')} style={segBtn(filter === 'high')}>★ Wysoko oceniane</button>
            </div>
            <div style={{ font: "500 12.5px 'Hanken Grotesk'", color: 'var(--text-3)' }}>
              {filter === 'high'
                ? plural(stats.highCount, 'wysoko oceniony', 'wysoko ocenione', 'wysoko ocenionych')
                : `${plural(total, 'wpis', 'wpisy', 'wpisów')} · ${plural(stats.highCount, 'wysoko oceniony', 'wysoko ocenione', 'wysoko ocenionych')}`}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center', padding: '50px 24px', border: '1.5px dashed var(--border-2)', borderRadius: 18, background: 'var(--surface)' }}>
              <div style={{ fontFamily: "'Spectral', serif", fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>Brak wysoko ocenianych wpisów</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Oceń posiłek na 4–5 ★ przy zapisywaniu, a znajdzie się w tym widoku.</div>
              <button
                onClick={() => setFilter('all')}
                style={{ marginTop: 10, border: '1px solid var(--border-2)', background: 'transparent', color: 'var(--text)', borderRadius: 10, padding: '9px 16px', font: "600 13px 'Hanken Grotesk'", cursor: 'pointer' }}
              >
                Pokaż wszystko
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
              {groups.map((grp) => (
                <div key={grp.label}>
                  <div style={{ ...capStyle, letterSpacing: '.1em', marginBottom: 10 }}>{grp.label}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {grp.items.map((x) => (
                      <HistoryRow key={x.entry.id} item={x} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function StatTile({ cap, value, sub, small }: { cap: string; value: string; sub: string; small?: boolean }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 15, padding: '13px 15px', minWidth: 0 }}>
      <div style={{ ...capStyle, marginBottom: 7 }}>{cap}</div>
      <div
        style={{
          fontFamily: "'Spectral', serif",
          fontWeight: 600,
          fontSize: small ? 15.5 : 24,
          lineHeight: 1.15,
          color: 'var(--text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: small ? 'nowrap' : undefined,
          marginBottom: 2,
        }}
        title={small ? value : undefined}
      >
        {value}
      </div>
      <div style={{ font: "500 11.5px 'Hanken Grotesk'", color: 'var(--text-3)' }}>{sub}</div>
    </div>
  )
}

function HistoryRow({ item }: { item: Enriched }) {
  const nav = useNavigate()
  const { entry, recipe, occurrence, date } = item
  const clickable = !!recipe

  const weekday = date.toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '').toUpperCase()
  const meta = recipe
    ? [recipe.cuisine && `kuchnia ${cuisineLabel[recipe.cuisine]}`, `${recipe.time} min`].filter(Boolean).join(' · ')
    : null

  return (
    <div
      onClick={clickable ? () => nav(`/recipe/${recipe.id}`) : undefined}
      onMouseEnter={(e) => clickable && (e.currentTarget.style.borderColor = 'var(--border-2)')}
      onMouseLeave={(e) => clickable && (e.currentTarget.style.borderColor = 'var(--border)')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '13px 15px',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'border-color .15s',
      }}
    >
      <div style={{ flex: '0 0 44px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <span style={{ font: "600 10.5px 'Hanken Grotesk'", letterSpacing: '.06em', color: 'var(--text-3)' }}>{weekday}</span>
        <span style={{ fontFamily: "'Spectral', serif", fontSize: 20, fontWeight: 600, color: 'var(--text)', lineHeight: 1.1 }}>{date.getDate()}</span>
      </div>

      <div style={{ flex: '0 0 46px', width: 46, height: 46, borderRadius: 12, overflow: 'hidden', position: 'relative', background: gradient(recipe?.tint ?? '#b8a98c'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {recipe?.imageUrl ? (
          <img src={recipe.imageUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontFamily: "'Spectral', serif", fontSize: 22, fontWeight: 500, color: 'rgba(255,255,255,.92)' }}>
            {(recipe?.title ?? entry.dishName)[0]}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 16.5, color: 'var(--text)', lineHeight: 1.2 }}>
            {recipe?.title ?? entry.dishName}
          </span>
          {occurrence > 1 && (
            <span style={{ font: "600 10.5px 'Hanken Grotesk'", color: 'var(--gold)', background: 'rgba(189,139,44,.12)', borderRadius: 7, padding: '2px 7px', whiteSpace: 'nowrap' }}>
              {occurrence}. raz
            </span>
          )}
        </div>
        {meta && <div style={{ font: "500 12px 'Hanken Grotesk'", color: 'var(--text-3)', marginTop: 2 }}>{meta}</div>}
        {entry.note && (
          <div style={{ fontStyle: 'italic', fontSize: 13, lineHeight: 1.45, color: 'var(--text-2)', marginTop: 6 }}>„{entry.note}”</div>
        )}
      </div>

      {entry.rating !== null && (
        <span style={{ color: 'var(--gold)', fontSize: 13, flex: '0 0 auto', letterSpacing: 1 }} title={`Ocena: ${entry.rating}/5`}>
          {'★'.repeat(entry.rating)}
          <span style={{ color: 'var(--border-2)' }}>{'★'.repeat(5 - entry.rating)}</span>
        </span>
      )}

      {clickable && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            nav(`/recipe/${recipe.id}`, { state: { cook: true } })
          }}
          title="Otwórz przepis z panelem „Ugotowane!”"
          style={{ flex: '0 0 auto', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text-2)', borderRadius: 9, padding: '6px 11px', font: "600 12px 'Hanken Grotesk'", cursor: 'pointer', whiteSpace: 'nowrap' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-deep)'; e.currentTarget.style.borderColor = 'var(--border-2)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          Ugotuj ponownie
        </button>
      )}
    </div>
  )
}
