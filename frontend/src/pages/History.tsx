import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useCookLog, useRecipes, useUpdateCookLog } from '../api/hooks'
import type { CookLogEntry, RecipeListItem } from '../api/client'
import { cuisineLabel, plural } from '../lib/labels'
import { mondayOf, parseISODate } from '../lib/dates'
import { useIsMobile } from '../lib/useIsMobile'
import { RecipeThumb } from '../components/RecipeThumb'
import { Button, Eyebrow, PageTitle, Sheet, StatStrip, UnderlineTabs, inputStyle, mono, sans, usePagePad } from '../components/ui'

type Filter = 'all' | 'high'

/** An entry joined with its recipe (if still alive) and its 1-based repeat count. */
type Enriched = {
  entry: CookLogEntry
  recipe: RecipeListItem | undefined
  occurrence: number
  date: Date
}

const HIGH_RATING = 4

function groupLabel(date: Date, now: Date): string {
  const diff = Math.round((mondayOf(now).getTime() - mondayOf(date).getTime()) / 86_400_000)
  if (diff <= 0) return 'W tym tygodniu'
  if (diff <= 7) return 'W zeszłym tygodniu'
  const month = date.toLocaleDateString('pl-PL', { month: 'long' })
  return date.getFullYear() === now.getFullYear() ? month : `${month} ${date.getFullYear()}`
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span style={{ color: 'var(--gold)', fontSize: size, letterSpacing: 2, whiteSpace: 'nowrap' }} title={`Ocena: ${value}/5`}>
      {'★'.repeat(value)}
      <span style={{ color: 'var(--border)' }}>{'★'.repeat(5 - value)}</span>
    </span>
  )
}

export function History() {
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { canEdit } = useAuth()
  const { data: entries = [], isLoading } = useCookLog(undefined, 500)
  const { data: recipes = [] } = useRecipes('all', '')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<Enriched | null>(null)

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

  if (isLoading) return <div style={{ ...pad, color: 'var(--text-3)' }}>Ładowanie…</div>

  const total = entries.length
  const summary =
    total === 0
      ? 'Każdy ugotowany posiłek zapisuje się tutaj — z oceną i notatką.'
      : `Razem ${plural(total, 'ugotowany posiłek', 'ugotowane posiłki', 'ugotowanych posiłków')}.` +
        (stats.topDish && stats.topDish.count > 1 ? ` Najczęściej na stole: ${stats.topDish.title} (${stats.topDish.count}×).` : '')

  const cuisine = stats.topCuisine ? capitalize(cuisineLabel[stats.topCuisine[0] as keyof typeof cuisineLabel]) : '—'
  const statItems = [
    { value: stats.thisMonth, label: isMobile ? 'w tym miesiącu' : `${plural(stats.thisMonth, 'posiłek', 'posiłki', 'posiłków').replace(/^\d+ /, '')} w tym miesiącu` },
    { value: stats.streak > 0 ? stats.streak : '—', label: stats.streak > 0 ? `${plural(stats.streak, 'tydzień', 'tygodnie', 'tygodni').replace(/^\d+ /, '')} z rzędu` : isMobile ? 'seria' : 'brak serii' },
    ...(isMobile ? [] : [{ value: stats.topDish?.title ?? '—', serif: true, label: stats.topDish ? `najczęściej · ${stats.topDish.count}×` : 'najczęściej' }]),
    { value: cuisine, serif: true, label: isMobile ? 'ulubiona kuchnia' : `ulubiona kuchnia${stats.topCuisine ? ` · ${plural(stats.topCuisine[1], 'danie', 'dania', 'dań')}` : ''}` },
  ]

  return (
    <div style={{ ...pad, maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 16 : 28 }}>
      {isMobile && (
        <button type="button" onClick={() => nav('/profile')} style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: sans(14, 600), color: 'var(--text-2)' }}>← Ja</button>
      )}
      <PageTitle title="Historia gotowania" size={isMobile ? 40 : undefined} sub={summary} />

      {total === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, padding: '24px 0', borderTop: '1px solid var(--rule)' }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 26 }}>Historia jest jeszcze pusta</span>
          <span style={{ font: sans(15), color: 'var(--text-2)', maxWidth: '46ch' }}>Ugotuj coś i kliknij „Ugotowane!” na stronie przepisu — każdy posiłek zapisze się tutaj.</span>
          <Button variant="outline" onClick={() => nav('/')}>Przeglądaj przepisy</Button>
        </div>
      ) : (
        <>
          <StatStrip stacked items={statItems} />
          <UnderlineTabs
            rule={false}
            style={{ borderBottom: '1px solid var(--border)' }}
            value={filter}
            onChange={setFilter}
            items={[
              { key: 'all', label: 'Wszystko', count: total },
              { key: 'high', label: '★ Wysoko oceniane', count: stats.highCount },
            ]}
          />
          {filtered.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '12px 0' }}>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 24 }}>Brak wysoko ocenianych wpisów</span>
              <span style={{ font: sans(14.5), color: 'var(--text-2)' }}>Oceń posiłek na 4–5 ★ przy zapisywaniu, a znajdzie się w tym widoku.</span>
              <Button variant="outline" onClick={() => setFilter('all')}>Pokaż wszystko</Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 16 : 20 }}>
              {groups.map((grp) => (
                <div key={grp.label} style={{ display: 'flex', flexDirection: 'column' }}>
                  <Eyebrow style={{ paddingBottom: 8 }}>{grp.label}</Eyebrow>
                  {grp.items.map((x, i) => (
                    <HistoryRow key={x.entry.id} item={x} first={i === 0} canEdit={canEdit} onEdit={() => setEditing(x)} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edytuj wpis">
        {editing && <EditForm key={editing.entry.id} entry={editing.entry} hasRecipe={!!editing.recipe} onClose={() => setEditing(null)} />}
      </Sheet>
    </div>
  )
}

/** Date, dish name (free-text entries only), stars, note. */
function EditForm({ entry, hasRecipe, onClose }: { entry: CookLogEntry; hasRecipe: boolean; onClose: () => void }) {
  const update = useUpdateCookLog()
  const [dishName, setDishName] = useState(entry.dishName)
  const [rating, setRating] = useState<number | null>(entry.rating)
  const [note, setNote] = useState(entry.note)
  const [cookedAt, setCookedAt] = useState(entry.cookedAt)

  function save() {
    update.mutate(
      {
        id: entry.id,
        input: {
          dishName: hasRecipe ? undefined : dishName.trim() || undefined,
          rating,
          note: note.trim() || undefined,
          cookedAt: cookedAt || undefined,
        },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!hasRecipe && <input value={dishName} onChange={(e) => setDishName(e.target.value)} placeholder="Nazwa dania" style={inputStyle} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <input type="date" value={cookedAt} onChange={(e) => setCookedAt(e.target.value)} style={{ ...inputStyle, width: 170, font: mono(14) }} />
        <span style={{ display: 'inline-flex' }} title="Kliknij gwiazdkę; ta sama gwiazdka ponownie czyści ocenę">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(rating === n ? null : n)}
              style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: '0 2px', fontSize: 24, lineHeight: 1, color: rating !== null && n <= rating ? 'var(--gold)' : 'var(--border)' }}
            >
              ★
            </button>
          ))}
        </span>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notatka — np. „następnym razem mniej soli”"
        rows={3}
        style={{ ...inputStyle, height: 'auto', padding: '12px 14px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.45 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={save} disabled={update.isPending}>{update.isPending ? 'Zapisywanie…' : 'Zapisz'}</Button>
        <Button variant="quiet" onClick={onClose}>Anuluj</Button>
      </div>
    </div>
  )
}

function HistoryRow({ item, first, canEdit, onEdit }: { item: Enriched; first: boolean; canEdit: boolean; onEdit: () => void }) {
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const { entry, recipe, occurrence, date } = item
  const title = recipe?.title ?? entry.dishName
  const weekday = date.toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '').toUpperCase()
  const meta = [recipe?.cuisine && `kuchnia ${cuisineLabel[recipe.cuisine]}`, recipe && `${recipe.time} min`, occurrence > 1 && `${occurrence}. raz`]
    .filter(Boolean)
    .join(' · ')
  const open = recipe ? () => nav(`/recipe/${recipe.id}`) : undefined
  const again = recipe && canEdit ? () => nav(`/recipe/${recipe.id}`, { state: { cook: true } }) : undefined
  const thumb = <RecipeThumb r={{ imageUrl: recipe?.imageUrl ?? null, tint: recipe?.tint ?? '#b8a98c', title }} letterSize={24} style={{ width: isMobile ? 56 : 64, height: isMobile ? 56 : 64, borderRadius: isMobile ? 9 : 10 }} />
  const dateCol = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: isMobile ? 34 : 56, flex: 'none' }}>
      <span style={{ font: mono(isMobile ? 10 : 10.5, 500), color: 'var(--text-3)' }}>{weekday}</span>
      <span style={{ fontFamily: 'var(--serif)', fontSize: isMobile ? 24 : 28, lineHeight: 1 }}>{date.getDate()}</span>
    </div>
  )
  const text = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 3 : 4, minWidth: 0, flex: 1 }}>
      <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 17 : 20, lineHeight: 1.15 }}>{title}</span>
      {(meta || (isMobile && entry.rating !== null)) && (
        <span style={{ font: sans(isMobile ? 12.5 : 13), color: 'var(--text-3)' }}>
          {meta}
          {isMobile && entry.rating !== null && <>{meta && ' · '}<span style={{ color: 'var(--gold)' }}>{'★'.repeat(entry.rating)}</span></>}
        </span>
      )}
      {entry.note && <span style={{ font: sans(13.5), fontStyle: 'italic', color: 'var(--text-2)', lineHeight: 1.4 }}>„{entry.note}”</span>}
    </div>
  )
  const rowBase: CSSProperties = { padding: isMobile ? '12px 0' : '14px 0', borderTop: first && !isMobile ? '1px solid var(--rule)' : '1px solid var(--border)', cursor: open ? 'pointer' : 'default' }

  if (isMobile) {
    return (
      <div onClick={open} style={{ ...rowBase, display: 'flex', alignItems: 'center', gap: 14 }}>
        {dateCol}
        {thumb}
        {text}
        {canEdit && (
          <button
            type="button"
            aria-label={again ? 'Ugotuj ponownie' : 'Edytuj'}
            onClick={(e) => {
              e.stopPropagation()
              ;(again ?? onEdit)()
            }}
            style={{ width: 40, height: 40, flex: '0 0 40px', borderRadius: '50%', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--text)' }}
          >
            {again ? '↻' : '✎'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div onClick={open} style={{ ...rowBase, display: 'grid', gridTemplateColumns: '56px 64px minmax(0,1fr) 120px 260px', alignItems: 'center', gap: 20 }}>
      {dateCol}
      {thumb}
      {text}
      {entry.rating !== null ? <Stars value={entry.rating} /> : <span style={{ font: sans(13), color: 'var(--text-3)' }}>bez oceny</span>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }} onClick={(e) => e.stopPropagation()}>
        {canEdit && <Button variant="quiet" size="sm" style={{ font: sans(13.5, 600) }} onClick={onEdit}>Edytuj</Button>}
        {again && <Button variant="outline" size="sm" style={{ font: sans(13.5, 600) }} onClick={again}>Ugotuj ponownie</Button>}
      </div>
    </div>
  )
}
