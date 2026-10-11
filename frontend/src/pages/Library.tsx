import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useRecipes } from '../api/hooks'
import type { Cuisine, DishType, RecipeListItem, Source } from '../api/client'
import { CUISINES, DIFFICULTIES, DISH_TYPES, cuisineLabel, dishLine, dishTypeLabel, sourceEyebrow, sourceLabel } from '../lib/labels'
import { FilterDropdown } from '../components/FilterDropdown'
import { RecipeThumb, StockNote } from '../components/RecipeThumb'
import { Button, Chip, Eyebrow, PageTitle, SearchField, Sheet, UnderlineTabs, mono, sans, usePagePad } from '../components/ui'
import { useIsMobile } from '../lib/useIsMobile'
import { useInfiniteScroll } from '../lib/useInfiniteScroll'
import { todayIso } from '../lib/dates'

const EMPTY_RECIPES: RecipeListItem[] = []

type Filter = 'all' | Source
type TimeBucket = '15' | '30' | '60' | '60plus'
type SortMode = 'alpha' | 'newest' | 'quickest' | 'missing' | 'origin'
type Stock = 'any' | 'have' | 'almost'

const TIME_BUCKETS: { key: TimeBucket; label: string }[] = [
  { key: '15', label: 'Do 15 min' },
  { key: '30', label: 'Do 30 min' },
  { key: '60', label: 'Do 60 min' },
  { key: '60plus', label: 'Ponad 60 min' },
]

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: 'newest', label: 'Najnowsze' },
  { key: 'alpha', label: 'A–Z' },
  { key: 'quickest', label: 'Najszybsze' },
  { key: 'missing', label: 'Najmniej brakuje' },
  { key: 'origin', label: 'Wg źródła' },
]

const STOCK_OPTIONS: { key: Stock; label: string }[] = [
  { key: 'any', label: 'Dowolne składniki' },
  { key: 'have', label: 'Mam wszystko' },
  { key: 'almost', label: 'Brakuje 1–2' },
]

/** Origin filter key: the trimmed, case-folded sourceName; '' = no source. */
function originKey(r: RecipeListItem): string {
  return r.sourceName?.trim().toLocaleLowerCase('pl-PL') ?? ''
}

/** Sources present in the collection, biggest first; recipes without one come last. */
function originOptions(recipes: RecipeListItem[]): { key: string; label: string; count: number }[] {
  const byKey = new Map<string, { key: string; label: string; count: number }>()
  for (const r of recipes) {
    const key = originKey(r)
    const entry = byKey.get(key) ?? { key, label: key ? r.sourceName!.trim() : 'Bez źródła', count: 0 }
    entry.count++
    byKey.set(key, entry)
  }
  return [...byKey.values()].sort(
    (a, b) => Number(!a.key) - Number(!b.key) || b.count - a.count || a.label.localeCompare(b.label, 'pl-PL'),
  )
}

function inTimeBucket(time: number, bucket: TimeBucket | null): boolean {
  if (bucket === null) return true
  if (bucket === '60plus') return time > 60
  return time <= Number(bucket)
}

/** Stable "today's pick" for the hero: a cookable recipe with a photo, else any photo, else the first. */
function pickHero(recipes: RecipeListItem[]): RecipeListItem | null {
  if (recipes.length === 0) return null
  const withPhoto = recipes.filter((r) => r.imageUrl)
  const ready = withPhoto.filter((r) => r.toBuyCount === 0)
  const pool = ready.length ? ready : withPhoto.length ? withPhoto : recipes
  const seed = [...todayIso()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  return [...pool].sort((a, b) => a.id.localeCompare(b.id))[seed % pool.length]
}

export function Library() {
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { canEdit } = useAuth()
  const { data: recipes = EMPTY_RECIPES, isLoading, isError, refetch } = useRecipes('all', '')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [dish, setDish] = useState<DishType | 'all'>('all')
  const [cuisine, setCuisine] = useState<Cuisine | 'all'>('all')
  const [origin, setOrigin] = useState<string | null>(null)
  const [timeBucket, setTimeBucket] = useState<TimeBucket | null>(null)
  const [difficulty, setDifficulty] = useState<string>('all')
  const [stock, setStock] = useState<Stock>('any')
  const [airFryerOnly, setAirFryerOnly] = useState(false)
  const [sort, setSort] = useState<SortMode>('newest')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [filterSheet, setFilterSheet] = useState(false)

  // One menu open at a time; any click outside a [data-dd] wrapper closes it.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!(e.target instanceof Element) || !e.target.closest('[data-dd]')) setOpenMenu(null)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  const counts = useMemo(
    () => ({
      all: recipes.length,
      ai: recipes.filter((r) => r.source === 'ai').length,
      web: recipes.filter((r) => r.source === 'web').length,
      manual: recipes.filter((r) => r.source === 'manual').length,
    }),
    [recipes],
  )

  const origins = useMemo(() => originOptions(recipes), [recipes])
  const originLabel = origins.find((o) => o.key === origin)?.label

  const view = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = recipes
      .filter((r) => filter === 'all' || r.source === filter)
      .filter((r) => dish === 'all' || r.dishType === dish)
      .filter((r) => cuisine === 'all' || r.cuisine === cuisine)
      .filter((r) => origin === null || originKey(r) === origin)
      .filter((r) => inTimeBucket(r.time, timeBucket))
      .filter((r) => difficulty === 'all' || r.difficulty === difficulty)
      .filter((r) => stock !== 'have' || r.toBuyCount === 0)
      .filter((r) => stock !== 'almost' || (r.toBuyCount >= 1 && r.toBuyCount <= 2))
      .filter((r) => !airFryerOnly || r.usesAirFryer)
      .filter((r) => !q || r.title.toLowerCase().includes(q) || (r.sourceName ?? '').toLowerCase().includes(q))
    // 'alpha' keeps the server order — it is already Polish-collated.
    if (sort === 'newest') filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (sort === 'quickest') filtered.sort((a, b) => a.time - b.time)
    if (sort === 'missing')
      filtered.sort((a, b) => a.toBuyCount - b.toBuyCount || b.createdAt.localeCompare(a.createdAt))
    // Stable sort over the A–Z server order, so titles stay alphabetical within a source.
    if (sort === 'origin')
      // Unnamed ones go last, grouped by the bucket their eyebrow shows.
      filtered.sort((a, b) => Number(!a.sourceName) - Number(!b.sourceName) || sourceEyebrow(a).localeCompare(sourceEyebrow(b), 'pl-PL', { sensitivity: 'base' }))
    return filtered
  }, [recipes, filter, dish, cuisine, origin, timeBucket, difficulty, stock, airFryerOnly, query, sort])

  const { visibleItems, sentinel, hasMore, loadMore } = useInfiniteScroll(view)

  const toolbarCount =
    Number(dish !== 'all') + Number(cuisine !== 'all') + Number(origin !== null) + Number(timeBucket !== null) +
    Number(difficulty !== 'all') + Number(stock !== 'any') + Number(airFryerOnly)
  const filtersActive = toolbarCount > 0 || filter !== 'all' || query.trim() !== ''
  // The editorial block (hero, shortcuts, newest) only shows while browsing everything.
  const browsing = !filtersActive && !isLoading && recipes.length > 0

  const hero = useMemo(() => (browsing ? pickHero(recipes) : null), [browsing, recipes])
  const newest = useMemo(
    () => [...recipes].filter((r) => r.id !== hero?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4),
    [recipes, hero],
  )

  function clearToolbarFilters() {
    setDish('all')
    setCuisine('all')
    setOrigin(null)
    setTimeBucket(null)
    setDifficulty('all')
    setStock('any')
    setAirFryerOnly(false)
    setOpenMenu(null)
  }

  function clearAllFilters() {
    clearToolbarFilters()
    setFilter('all')
    setQuery('')
  }

  function pick<T>(setter: (v: T) => void): (v: T) => void {
    return (v) => {
      setter(v)
      setOpenMenu(null)
    }
  }
  const menu = (key: string) => ({ open: openMenu === key, onToggle: () => setOpenMenu((m) => (m === key ? null : key)) })

  const open = (r: RecipeListItem) => nav(`/recipe/${r.id}`)
  const shortfall = stock === 'almost' || sort === 'missing'

  const tabs = (
    <UnderlineTabs
      rule={isMobile}
      value={filter}
      onChange={setFilter}
      items={[
        { key: 'all', label: 'Wszystkie', count: isMobile ? undefined : counts.all },
        { key: 'ai', label: sourceLabel.ai, count: counts.ai },
        { key: 'web', label: sourceLabel.web, count: counts.web },
        { key: 'manual', label: isMobile ? 'Moje' : sourceLabel.manual, count: isMobile ? undefined : counts.manual },
      ]}
    />
  )

  const desktopFilters = (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingBottom: 10 }}>
      <FilterDropdown
        {...menu('origin')}
        label={originLabel ?? 'Źródło'}
        active={origin !== null}
        options={[
          { label: 'Wszystkie źródła', selected: origin === null, onSelect: () => pick(setOrigin)(null) },
          ...origins.map((o) => ({ label: `${o.label} (${o.count})`, selected: origin === o.key, onSelect: () => pick(setOrigin)(o.key) })),
        ]}
      />
      <FilterDropdown
        {...menu('dish')}
        label={dish === 'all' ? 'Kategoria' : dishTypeLabel[dish]}
        active={dish !== 'all'}
        options={[
          { label: 'Wszystkie kategorie', selected: dish === 'all', onSelect: () => pick(setDish)('all') },
          ...DISH_TYPES.map((d) => ({ label: dishTypeLabel[d], selected: dish === d, onSelect: () => pick(setDish)(d) })),
        ]}
      />
      <FilterDropdown
        {...menu('cuisine')}
        label={cuisine === 'all' ? 'Kuchnia' : cuisineLabel[cuisine]}
        active={cuisine !== 'all'}
        options={[
          { label: 'Wszystkie kuchnie', selected: cuisine === 'all', onSelect: () => pick(setCuisine)('all') },
          ...CUISINES.map((c) => ({ label: cuisineLabel[c], selected: cuisine === c, onSelect: () => pick(setCuisine)(c) })),
        ]}
      />
      <FilterDropdown
        {...menu('time')}
        label={timeBucket === null ? 'Czas' : TIME_BUCKETS.find((b) => b.key === timeBucket)!.label}
        active={timeBucket !== null}
        options={[
          { label: 'Dowolny czas', selected: timeBucket === null, onSelect: () => pick(setTimeBucket)(null) },
          ...TIME_BUCKETS.map((b) => ({ label: b.label, selected: timeBucket === b.key, onSelect: () => pick(setTimeBucket)(b.key) })),
        ]}
      />
      <FilterDropdown
        {...menu('difficulty')}
        label={difficulty === 'all' ? 'Trudność' : difficulty}
        active={difficulty !== 'all'}
        options={[
          { label: 'Dowolna trudność', selected: difficulty === 'all', onSelect: () => pick(setDifficulty)('all') },
          ...DIFFICULTIES.map((d) => ({ label: d, selected: difficulty === d, onSelect: () => pick(setDifficulty)(d) })),
        ]}
      />
      <FilterDropdown
        {...menu('stock')}
        label={stock === 'any' ? 'Składniki' : STOCK_OPTIONS.find((o) => o.key === stock)!.label}
        active={stock !== 'any'}
        options={STOCK_OPTIONS.map((o) => ({ label: o.label, selected: stock === o.key, onSelect: () => pick(setStock)(o.key) }))}
      />
      <Chip active={airFryerOnly} onClick={() => setAirFryerOnly(!airFryerOnly)}>
        Frytkownica{airFryerOnly && ' ✕'}
      </Chip>
      {toolbarCount > 0 && (
        <button type="button" onClick={clearToolbarFilters} style={{ border: 0, background: 'transparent', cursor: 'pointer', font: sans(13, 600), color: 'var(--accent-text)', padding: '7px 4px' }}>
          Wyczyść
        </button>
      )}
      <FilterDropdown
        {...menu('sort')}
        muted
        align="right"
        active={false}
        label={SORT_OPTIONS.find((o) => o.key === sort)!.label}
        options={SORT_OPTIONS.map((o) => ({ label: o.label, selected: sort === o.key, onSelect: () => pick(setSort)(o.key) }))}
      />
    </div>
  )

  const mobileFilters = (
    <div className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -20px', padding: '0 20px' }}>
      <Chip active={toolbarCount > 0} onClick={() => setFilterSheet(true)}>
        Filtry{toolbarCount > 0 ? ` · ${toolbarCount}` : ''}
      </Chip>
      <Chip active={timeBucket === '30'} onClick={() => setTimeBucket(timeBucket === '30' ? null : '30')}>Do 30 min</Chip>
      <Chip active={stock === 'have'} onClick={() => setStock(stock === 'have' ? 'any' : 'have')}>Mam składniki</Chip>
      <Chip active={airFryerOnly} onClick={() => setAirFryerOnly(!airFryerOnly)}>Frytkownica</Chip>
      <Chip onClick={() => setFilterSheet(true)}>{SORT_OPTIONS.find((o) => o.key === sort)!.label} <span aria-hidden>▾</span></Chip>
    </div>
  )

  const tiles = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <Tile dark eyebrow="Nie wiem, co zjeść" title="Losuj obiad →" onClick={() => nav('/random')} />
      <Tile eyebrow="Bez zakupów" title="Z tego, co mam →" onClick={() => setStock('have')} />
    </div>
  )

  return (
    <div style={{ ...pad, maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 28 }}>
      <PageTitle
        title="Przepisy"
        count={counts.all || undefined}
        right={
          isMobile ? (
            canEdit && <Button variant="outline" size="sm" onClick={() => nav('/add')}>+ Dodaj</Button>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <SearchField value={query} onChange={setQuery} placeholder="Szukaj po nazwie lub źródle" style={{ width: 340 }} />
              {canEdit && <Button onClick={() => nav('/add')}>+ Dodaj przepis</Button>}
            </div>
          )
        }
      />

      {isMobile ? (
        <>
          <SearchField value={query} onChange={setQuery} placeholder="Szukaj po nazwie lub źródle" />
          {browsing && tiles}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tabs}
            {mobileFilters}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 24, rowGap: 4, borderBottom: '1px solid var(--rule)' }}>
          {tabs}
          {desktopFilters}
        </div>
      )}

      {isError ? (
        <div role="alert" style={{ color: 'var(--text-2)', padding: '40px 0' }}>
          Nie udało się załadować przepisów.{' '}
          <Button variant="text" onClick={() => refetch()} style={{ color: 'var(--accent-text)' }}>Spróbuj ponownie</Button>
        </div>
      ) : isLoading ? (
        <div style={{ color: 'var(--text-3)', padding: '40px 0' }}>Ładowanie…</div>
      ) : view.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '28px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 500 }}>
            {filtersActive ? 'Nic nie pasuje do tych filtrów' : 'Nie ma tu jeszcze przepisów'}
          </span>
          {filtersActive && (
            <>
              <span style={{ font: sans(15), color: 'var(--text-2)' }}>Poluzuj któryś filtr — albo poproś Sous o coś, co pasuje.</span>
              <Button variant="outline" onClick={clearAllFilters}>Wyczyść wszystkie filtry</Button>
            </>
          )}
        </div>
      ) : (
        <>
          {browsing && hero && (
            isMobile ? (
              <Hero r={hero} onOpen={() => open(hero)} />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.45fr) minmax(0,1fr)', gap: 44 }}>
                <Hero r={hero} onOpen={() => open(hero)} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                  {tiles}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <Eyebrow style={{ paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>Ostatnio dodane</Eyebrow>
                    {newest.map((r) => <Row key={r.id} r={r} heading={false} onOpen={() => open(r)} />)}
                  </div>
                </div>
              </div>
            )
          )}

          {isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {visibleItems.map((r, i) => (
                <Row key={r.id} r={r} first={i === 0} shortfall={shortfall} onOpen={() => open(r)} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, borderTop: browsing ? '1px solid var(--rule)' : undefined, paddingTop: browsing ? 20 : 0 }}>
              {browsing && <Eyebrow>Wszystkie przepisy · {view.length}</Eyebrow>}
              {!browsing && <Eyebrow>{view.length} z {counts.all}</Eyebrow>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', columnGap: 24, rowGap: 32 }}>
                {visibleItems.map((r) => <GridCard key={r.id} r={r} shortfall={shortfall} onOpen={() => open(r)} />)}
              </div>
            </div>
          )}

          <div ref={sentinel} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '8px 0 0', font: mono(12), color: 'var(--text-3)' }}>
            <span role="status">Wyświetlono {visibleItems.length} z {view.length} przepisów</span>
            {hasMore && <Chip onClick={loadMore}>Pokaż więcej</Chip>}
          </div>
        </>
      )}

      <Sheet open={filterSheet} onClose={() => setFilterSheet(false)} title="Filtry">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <ChipGroup label="Kategoria">
            <Chip active={dish === 'all'} onClick={() => setDish('all')}>Wszystkie</Chip>
            {DISH_TYPES.map((d) => <Chip key={d} active={dish === d} onClick={() => setDish(d)}>{dishTypeLabel[d]}</Chip>)}
          </ChipGroup>
          <ChipGroup label="Kuchnia">
            <Chip active={cuisine === 'all'} onClick={() => setCuisine('all')}>Wszystkie</Chip>
            {CUISINES.map((c) => <Chip key={c} active={cuisine === c} onClick={() => setCuisine(c)}>{cuisineLabel[c]}</Chip>)}
          </ChipGroup>
          <ChipGroup label="Źródło">
            <Chip active={origin === null} onClick={() => setOrigin(null)}>Wszystkie</Chip>
            {origins.map((o) => <Chip key={o.key} active={origin === o.key} onClick={() => setOrigin(o.key)}>{o.label} · {o.count}</Chip>)}
          </ChipGroup>
          <ChipGroup label="Czas">
            <Chip active={timeBucket === null} onClick={() => setTimeBucket(null)}>Dowolny</Chip>
            {TIME_BUCKETS.map((b) => <Chip key={b.key} active={timeBucket === b.key} onClick={() => setTimeBucket(b.key)}>{b.label}</Chip>)}
          </ChipGroup>
          <ChipGroup label="Trudność">
            <Chip active={difficulty === 'all'} onClick={() => setDifficulty('all')}>Dowolna</Chip>
            {DIFFICULTIES.map((d) => <Chip key={d} active={difficulty === d} onClick={() => setDifficulty(d)}>{d}</Chip>)}
          </ChipGroup>
          <ChipGroup label="Składniki">
            {STOCK_OPTIONS.map((o) => <Chip key={o.key} active={stock === o.key} onClick={() => setStock(o.key)}>{o.label}</Chip>)}
            <Chip active={airFryerOnly} onClick={() => setAirFryerOnly(!airFryerOnly)}>Frytkownica</Chip>
          </ChipGroup>
          <ChipGroup label="Sortowanie">
            {SORT_OPTIONS.map((o) => <Chip key={o.key} active={sort === o.key} onClick={() => setSort(o.key)}>{o.label}</Chip>)}
          </ChipGroup>
          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <Button variant="outline" size="xl" style={{ flex: 1 }} onClick={clearToolbarFilters}>Wyczyść</Button>
            <Button size="xl" style={{ flex: 1.4 }} onClick={() => setFilterSheet(false)}>Pokaż {view.length}</Button>
          </div>
        </div>
      </Sheet>
    </div>
  )
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  )
}

function Tile({ eyebrow, title, dark, onClick }: { eyebrow: string; title: string; dark?: boolean; onClick: () => void }) {
  const isMobile = useIsMobile()
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: isMobile ? 18 : 20,
        minHeight: isMobile ? 92 : 108,
        padding: isMobile ? 14 : 16,
        borderRadius: 14,
        border: 0,
        cursor: 'pointer',
        textAlign: 'left',
        background: dark ? 'var(--text)' : 'var(--accent-soft)',
        color: dark ? 'var(--bg)' : 'var(--text)',
      }}
    >
      <Eyebrow tone={dark ? 'light' : 'muted'} style={dark ? undefined : { color: 'var(--accent-soft-text)' }}>{eyebrow}</Eyebrow>
      <span style={{ fontFamily: 'var(--serif)', fontSize: isMobile ? 22 : 24, lineHeight: 1.05 }}>{title}</span>
    </button>
  )
}

const badgeStyle: CSSProperties = {
  position: 'absolute',
  left: 16,
  top: 16,
  font: mono(10.5, 500),
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  padding: '5px 8px',
  borderRadius: 5,
  background: 'var(--surface)',
  color: 'var(--text)',
}

function Hero({ r, onOpen }: { r: RecipeListItem; onOpen: () => void }) {
  const isMobile = useIsMobile()
  const line = dishLine(r)
  return (
    <div onClick={onOpen} style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16, cursor: 'pointer', minWidth: 0 }}>
      <div style={{ position: 'relative' }}>
        <RecipeThumb r={r} full letterSize={80} style={{ height: isMobile ? 190 : 380, borderRadius: isMobile ? 14 : 16 }} />
        {!isMobile && <span style={badgeStyle}>{sourceEyebrow(r)}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 5 : 8, minWidth: 0 }}>
          {line && !isMobile && <Eyebrow tone="accent">{line}</Eyebrow>}
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 24 : 36, lineHeight: isMobile ? 1.1 : 1.05, letterSpacing: '-0.02em' }}>{r.title}</span>
          {isMobile && (
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10, font: mono(12), color: 'var(--text-2)' }}>
              <span>{r.time} min</span>
              {r.kcal != null && <span>~{r.kcal} kcal</span>}
              <StockNote toBuy={r.toBuyCount} />
            </span>
          )}
        </div>
        {!isMobile && (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: 'none', font: mono(13), color: 'var(--text-2)' }}>
            <span>{r.time} min{r.kcal != null && ` · ~${r.kcal} kcal`}</span>
            <StockNote toBuy={r.toBuyCount} />
          </span>
        )}
      </div>
    </div>
  )
}

/** Thumbnail list row (desktop "Ostatnio dodane", the whole list on phones). */
function Row({ r, onOpen, first, shortfall, heading = true }: { r: RecipeListItem; onOpen: () => void; first?: boolean; shortfall?: boolean; heading?: boolean }) {
  const Title = heading ? 'h3' : 'span'
  const isMobile = useIsMobile()
  const size = isMobile ? 76 : 84
  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex',
        gap: isMobile ? 14 : 16,
        padding: '14px 0',
        cursor: 'pointer',
        borderBottom: isMobile ? undefined : '1px solid var(--border)',
        borderTop: isMobile && !first ? '1px solid var(--border)' : undefined,
      }}
    >
      <RecipeThumb r={r} letterSize={30} style={{ width: size, height: size, borderRadius: 10 }} />
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, minWidth: 0 }}>
        <Eyebrow size={10.5}>{sourceEyebrow(r)}</Eyebrow>
        <Title style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 19 : 20, lineHeight: 1.15 }}>{r.title}</Title>
        <span style={{ display: 'flex', gap: 10, font: mono(12), color: 'var(--text-2)' }}>
          <span>{r.time} min</span>
          <StockNote toBuy={r.toBuyCount} short={shortfall} />
        </span>
      </div>
    </div>
  )
}

function GridCard({ r, onOpen, shortfall }: { r: RecipeListItem; onOpen: () => void; shortfall?: boolean }) {
  return (
    <div onClick={onOpen} style={{ display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer', minWidth: 0 }}>
      <RecipeThumb r={r} letterSize={56} style={{ height: 170, borderRadius: 12 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <Eyebrow size={10.5}>{sourceEyebrow(r)}</Eyebrow>
        <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 19, lineHeight: 1.2 }}>{r.title}</h3>
        <span style={{ display: 'flex', flexWrap: 'wrap', columnGap: 10, font: mono(12), color: 'var(--text-2)' }}>
          <span>{r.time} min</span>
          {r.kcal != null && <span>~{r.kcal} kcal</span>}
          <StockNote toBuy={r.toBuyCount} short={shortfall} />
        </span>
      </div>
    </div>
  )
}
