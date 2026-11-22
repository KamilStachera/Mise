import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, useChatHealth, useRecipes, useSetRecipeFavorite } from '../api/hooks'
import { FirstStepsCard } from '../components/FirstStepsCard'
import { ZmierzchLink } from '../zmierzch/ZmierzchLink'
import type { Cuisine, DishType, RecipeListItem, Source } from '../api/client'
import { CUISINES, DIFFICULTIES, DISH_TYPES, cuisineLabel, dishLine, dishTypeLabel, formatGrams, formatKcal, plural, sourceEyebrow, sourceLabel } from '../lib/labels'
import { requestChat } from '../lib/chatBus'
import { matchesRecipeQuery, normalizeTag } from '../lib/recipeParsing'
import { FilterDropdown } from '../components/FilterDropdown'
import { RecipeThumb, StockNote } from '../components/RecipeThumb'
import { SousButton } from '../components/SousButton'
import { Button, Chip, Eyebrow, PageTitle, SearchField, Sheet, UnderlineTabs, mono, sans, usePagePad } from '../components/ui'
import { useIsMobile } from '../lib/useIsMobile'
import { useInfiniteScroll } from '../lib/useInfiniteScroll'
import { useSessionState } from '../lib/useSessionState'
import { todayIso } from '../lib/dates'

const EMPTY_RECIPES: RecipeListItem[] = []

/** sessionStorage prefix for the list's filters and loaded batch. */
const KEY = 'pichci-recipes:'
const isString = (v: unknown) => typeof v === 'string'
const oneOf = (...allowed: unknown[]) => (v: unknown) => allowed.includes(v)

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

/** Tags present across the household's recipes, most-used first. */
function tagOptions(recipes: RecipeListItem[]): { tag: string; count: number }[] {
  const byTag = new Map<string, number>()
  for (const r of recipes) {
    for (const t of r.tags ?? []) byTag.set(t, (byTag.get(t) ?? 0) + 1)
  }
  return [...byTag.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'pl-PL'))
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

const isNullablePosInt = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0)

export function Library() {
  const nav = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { canEdit } = useAuth()
  const { data: chatHealth } = useChatHealth()
  const setFav = useSetRecipeFavorite()
  const { data: recipes = EMPTY_RECIPES, isLoading, isError, refetch } = useRecipes('all', '')
  // Filters live in sessionStorage so opening a recipe and coming back keeps them.
  const [filter, setFilter] = useSessionState<Filter>(`${KEY}source`, 'all', oneOf('all', 'ai', 'web', 'manual'))
  const [query, setQuery] = useSessionState(`${KEY}query`, '', isString)
  const [dish, setDish] = useSessionState<DishType | 'all'>(`${KEY}dish`, 'all', oneOf('all', ...DISH_TYPES))
  const [cuisine, setCuisine] = useSessionState<Cuisine | 'all'>(`${KEY}cuisine`, 'all', oneOf('all', ...CUISINES))
  const [origin, setOrigin] = useSessionState<string | null>(`${KEY}origin`, null, (v) => v === null || isString(v))
  const [tag, setTag] = useSessionState<string | null>(`${KEY}tag`, null, (v) => v === null || isString(v))
  const [favoriteOnly, setFavoriteOnly] = useSessionState(`${KEY}favorite`, false, (v) => typeof v === 'boolean')
  const [timeBucket, setTimeBucket] = useSessionState<TimeBucket | null>(`${KEY}time`, null, oneOf(null, ...TIME_BUCKETS.map((b) => b.key)))
  const [difficulty, setDifficulty] = useSessionState(`${KEY}difficulty`, 'all', oneOf('all', ...DIFFICULTIES))
  const [stock, setStock] = useSessionState<Stock>(`${KEY}stock`, 'any', oneOf(...STOCK_OPTIONS.map((o) => o.key)))
  const [airFryerOnly, setAirFryerOnly] = useSessionState(`${KEY}airFryer`, false, (v) => typeof v === 'boolean')
  const [budgetKcal, setBudgetKcal] = useSessionState<number | null>(`${KEY}budgetKcal`, null, isNullablePosInt)
  const [budgetProtein, setBudgetProtein] = useSessionState<number | null>(`${KEY}budgetProtein`, null, isNullablePosInt)
  const [highProteinOnly, setHighProteinOnly] = useSessionState(`${KEY}highProtein`, false, (v) => typeof v === 'boolean')
  const [sort, setSort] = useSessionState<SortMode>(`${KEY}sort`, 'newest', oneOf(...SORT_OPTIONS.map((o) => o.key)))
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [filterSheet, setFilterSheet] = useState(false)

  // Deep links from DayView (/?budgetKcal=520&budgetProtein=42) or RecipeDetail (/?tag=szybkie).
  useEffect(() => {
    const rawBudget = searchParams.get('budgetKcal')
    const rawProt = searchParams.get('budgetProtein')
    const rawTag = searchParams.get('tag')
    if (rawBudget === null && rawTag === null) return
    if (rawBudget !== null) {
      const k = Number(rawBudget)
      if (Number.isFinite(k) && k > 0) {
        setBudgetKcal(Math.round(k))
        const p = rawProt !== null ? Number(rawProt) : NaN
        setBudgetProtein(Number.isFinite(p) && p > 0 ? Math.round(p) : null)
        setHighProteinOnly(false)
        setFilter('all')
        setQuery('')
      }
    }
    if (rawTag !== null) {
      const clean = normalizeTag(rawTag)
      if (clean) {
        setTag(clean)
        setBudgetKcal(null)
        setBudgetProtein(null)
        setHighProteinOnly(false)
      }
    }
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

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
      favorites: recipes.filter((r) => r.isFavorite).length,
    }),
    [recipes],
  )

  const origins = useMemo(() => originOptions(recipes), [recipes])
  const originLabel = origins.find((o) => o.key === origin)?.label
  const allTags = useMemo(() => tagOptions(recipes), [recipes])
  const availableDishTypes = useMemo(() => {
    const map = new Map<DishType, number>()
    for (const r of recipes) if (r.dishType) map.set(r.dishType, (map.get(r.dishType) ?? 0) + 1)
    return DISH_TYPES.filter((d) => map.has(d) || dish === d).map((d) => ({ key: d, count: map.get(d) ?? 0 }))
  }, [recipes, dish])
  const availableCuisines = useMemo(() => {
    const map = new Map<Cuisine, number>()
    for (const r of recipes) if (r.cuisine) map.set(r.cuisine, (map.get(r.cuisine) ?? 0) + 1)
    return CUISINES.filter((c) => map.has(c) || cuisine === c).map((c) => ({ key: c, count: map.get(c) ?? 0 }))
  }, [recipes, cuisine])
  const proteinFloor = budgetProtein != null ? Math.min(25, budgetProtein) : 25

  const view = useMemo(() => {
    const filtered = recipes
      .filter((r) => filter === 'all' || r.source === filter)
      .filter((r) => dish === 'all' || r.dishType === dish)
      .filter((r) => cuisine === 'all' || r.cuisine === cuisine)
      .filter((r) => origin === null || originKey(r) === origin)
      .filter((r) => tag === null || (r.tags ?? []).includes(tag))
      .filter((r) => !favoriteOnly || r.isFavorite)
      .filter((r) => inTimeBucket(r.time, timeBucket))
      .filter((r) => difficulty === 'all' || r.difficulty === difficulty)
      .filter((r) => stock !== 'have' || r.toBuyCount === 0)
      .filter((r) => stock !== 'almost' || (r.toBuyCount >= 1 && r.toBuyCount <= 2))
      .filter((r) => !airFryerOnly || r.usesAirFryer)
      .filter((r) => budgetKcal === null || (r.kcal != null && r.kcal <= budgetKcal))
      .filter((r) => !highProteinOnly || (r.protein ?? 0) >= proteinFloor)
      .filter((r) => matchesRecipeQuery(r, query))
    // In budget mode, surface the most cookable, highest-protein dishes fitting the remaining kcal first.
    if (budgetKcal !== null) {
      filtered.sort(
        (a, b) =>
          a.toBuyCount - b.toBuyCount ||
          (b.protein ?? -1) - (a.protein ?? -1) ||
          (b.kcal ?? 0) - (a.kcal ?? 0),
      )
      return filtered
    }
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
  }, [recipes, filter, dish, cuisine, origin, tag, favoriteOnly, timeBucket, difficulty, stock, airFryerOnly, budgetKcal, highProteinOnly, proteinFloor, query, sort])

  const resetKey = JSON.stringify([filter, query.trim(), dish, cuisine, origin, tag, favoriteOnly, timeBucket, difficulty, stock, airFryerOnly, budgetKcal, highProteinOnly, sort])
  const { visibleItems, sentinel, hasMore, loadMore } = useInfiniteScroll(view, resetKey, `${KEY}page`)

  const toolbarCount =
    Number(dish !== 'all') + Number(cuisine !== 'all') + Number(origin !== null) + Number(tag !== null) +
    Number(favoriteOnly) + Number(timeBucket !== null) + Number(difficulty !== 'all') + Number(stock !== 'any') + Number(airFryerOnly)
  const filtersActive = toolbarCount > 0 || filter !== 'all' || query.trim() !== '' || budgetKcal !== null
  // The editorial block (hero, shortcuts, newest) only shows while browsing everything.
  const browsing = !filtersActive && !isLoading && recipes.length > 0

  const hero = useMemo(() => (browsing ? pickHero(recipes) : null), [browsing, recipes])
  const newest = useMemo(
    () => [...recipes].filter((r) => r.id !== hero?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4),
    [recipes, hero],
  )
  // Avoid repeating the hero and 4 newest cards as row 1 of the desktop grid when browsing newest-first.
  const featuredIds = useMemo(() => {
    if (!browsing || isMobile || sort !== 'newest' || recipes.length <= 8) return null
    return new Set([hero?.id, ...newest.map((r) => r.id)].filter((x): x is string => Boolean(x)))
  }, [browsing, isMobile, sort, recipes.length, hero, newest])
  const gridView = useMemo(
    () => (featuredIds ? view.filter((r) => !featuredIds.has(r.id)) : view),
    [view, featuredIds],
  )
  const { visibleItems: gridVisibleItems, sentinel: gridSentinel, hasMore: gridHasMore, loadMore: gridLoadMore } =
    useInfiniteScroll(gridView, `${resetKey}:${Boolean(featuredIds)}`, `${KEY}page-grid`)

  // Extra filters beyond the 3 quick chips (Ulubione / Do 30 min / Mam składniki).
  const sheetFilterCount =
    Number(dish !== 'all')
    + Number(cuisine !== 'all')
    + Number(origin !== null)
    + Number(tag !== null)
    + Number(timeBucket !== null && timeBucket !== '30')
    + Number(difficulty !== 'all')
    + Number(stock === 'almost')
    + Number(airFryerOnly)

  const activeBadges: { key: string; label: string; clear: () => void }[] = [
    ...(dish !== 'all' ? [{ key: 'dish', label: `Kategoria: ${dishTypeLabel[dish]}`, clear: () => setDish('all') }] : []),
    ...(cuisine !== 'all' ? [{ key: 'cuisine', label: `Kuchnia: ${cuisineLabel[cuisine]}`, clear: () => setCuisine('all') }] : []),
    ...(origin !== null ? [{ key: 'origin', label: `Źródło: ${originLabel ?? origin}`, clear: () => setOrigin(null) }] : []),
    ...(tag !== null ? [{ key: 'tag', label: `#${tag}`, clear: () => setTag(null) }] : []),
    ...(timeBucket !== null && timeBucket !== '30' ? [{ key: 'time', label: TIME_BUCKETS.find((b) => b.key === timeBucket)!.label, clear: () => setTimeBucket(null) }] : []),
    ...(difficulty !== 'all' ? [{ key: 'diff', label: `Poziom: ${difficulty}`, clear: () => setDifficulty('all') }] : []),
    ...(stock === 'almost' ? [{ key: 'stock', label: 'Brakuje 1–2', clear: () => setStock('any') }] : []),
    ...(airFryerOnly ? [{ key: 'af', label: 'Frytkownica', clear: () => setAirFryerOnly(false) }] : []),
  ]

  function clearBudget() {
    setBudgetKcal(null)
    setBudgetProtein(null)
    setHighProteinOnly(false)
  }

  function clearToolbarFilters() {
    setDish('all')
    setCuisine('all')
    setOrigin(null)
    setTag(null)
    setFavoriteOnly(false)
    setTimeBucket(null)
    setDifficulty('all')
    setStock('any')
    setAirFryerOnly(false)
    setOpenMenu(null)
  }

  function clearAllFilters() {
    clearToolbarFilters()
    clearBudget()
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
  const toggleFav = canEdit ? (r: RecipeListItem) => setFav.mutate({ id: r.id, favorite: !r.isFavorite }) : undefined
  const shortfall = stock === 'almost' || sort === 'missing' || budgetKcal !== null

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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Chip active={favoriteOnly} onClick={() => setFavoriteOnly(!favoriteOnly)}>
          ★ Ulubione{counts.favorites > 0 && !favoriteOnly ? ` (${counts.favorites})` : ''}{favoriteOnly && ' ✕'}
        </Chip>
        <Chip active={timeBucket === '30'} onClick={() => setTimeBucket(timeBucket === '30' ? null : '30')}>
          Do 30 min{timeBucket === '30' && ' ✕'}
        </Chip>
        <Chip active={stock === 'have'} onClick={() => setStock(stock === 'have' ? 'any' : 'have')}>
          Mam składniki{stock === 'have' && ' ✕'}
        </Chip>
        <Button
          variant={sheetFilterCount > 0 ? 'dark' : 'outline'}
          size="sm"
          style={{ height: 34, font: sans(13, 600) }}
          onClick={() => setFilterSheet(true)}
        >
          Filtry{sheetFilterCount > 0 ? ` · ${sheetFilterCount}` : ''}
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ font: mono(11.5), color: 'var(--text-3)' }}>Sortuj:</span>
        <FilterDropdown
          {...menu('sort')}
          muted
          align="right"
          active={false}
          label={budgetKcal !== null ? 'Dopasowanie do budżetu' : SORT_OPTIONS.find((o) => o.key === sort)!.label}
          options={SORT_OPTIONS.map((o) => ({ label: o.label, selected: sort === o.key && budgetKcal === null, onSelect: () => { clearBudget(); pick(setSort)(o.key) } }))}
        />
      </div>
    </div>
  )

  const activeFilterChips = activeBadges.length > 0 && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {activeBadges.map((b) => (
        <button
          key={b.key}
          type="button"
          onClick={b.clear}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 11px',
            borderRadius: 999,
            border: '1px solid var(--accent-soft-text)',
            background: 'var(--accent-soft)',
            color: 'var(--accent-soft-text)',
            font: sans(12.5, 600),
            cursor: 'pointer',
          }}
        >
          {b.label}
          <span aria-hidden style={{ fontSize: 11 }}>✕</span>
        </button>
      ))}
      <button
        type="button"
        onClick={clearToolbarFilters}
        style={{ border: 0, background: 'transparent', cursor: 'pointer', font: sans(13, 600), color: 'var(--text-2)', padding: '4px 6px' }}
      >
        Wyczyść filtry
      </button>
    </div>
  )

  const mobileFilters = (
    <div className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -20px', padding: '0 20px' }}>
      <Button
        variant={toolbarCount > 0 ? 'dark' : 'outline'}
        size="sm"
        style={{ height: 34, font: sans(13, 600) }}
        onClick={() => setFilterSheet(true)}
      >
        Filtry{toolbarCount > 0 ? ` · ${toolbarCount}` : ''}
      </Button>
      <Chip active={favoriteOnly} onClick={() => setFavoriteOnly(!favoriteOnly)}>★ Ulubione</Chip>
      <Chip active={timeBucket === '30'} onClick={() => setTimeBucket(timeBucket === '30' ? null : '30')}>Do 30 min</Chip>
      <Chip active={stock === 'have'} onClick={() => setStock(stock === 'have' ? 'any' : 'have')}>Mam składniki</Chip>
      <Chip onClick={() => setFilterSheet(true)}>{SORT_OPTIONS.find((o) => o.key === sort)!.label} <span aria-hidden>▾</span></Chip>
    </div>
  )

  const budgetBanner = budgetKcal !== null && (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: isMobile ? 14 : 16,
        borderRadius: 14,
        background: 'var(--surface)',
        border: '1px solid var(--border-2)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Eyebrow tone="accent">W Twoim budżecie</Eyebrow>
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 21 : 24, lineHeight: 1.15 }}>
            Do {formatKcal(budgetKcal)} kcal
            {budgetProtein != null && budgetProtein > 0 && ` · brakuje ${budgetProtein} g białka`}
          </span>
          <span style={{ font: sans(13), color: 'var(--text-2)' }}>
            Pokazujemy {plural(view.length, 'przepis', 'przepisy', 'przepisów')} (posortowane wg dostępnych składników i białka).
          </span>
        </div>
        <button
          type="button"
          onClick={clearBudget}
          aria-label="Zamknij filtr budżetu"
          style={{ border: 0, background: 'transparent', cursor: 'pointer', font: sans(13, 600), color: 'var(--text-3)', padding: '2px 4px', whiteSpace: 'nowrap' }}
        >
          Zamknij ✕
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Chip onClick={() => setBudgetKcal(Math.max(100, budgetKcal - 100))}>−100 kcal</Chip>
        <Chip onClick={() => setBudgetKcal(Math.min(4000, budgetKcal + 100))}>+100 kcal</Chip>
        <Chip active={highProteinOnly} onClick={() => setHighProteinOnly(!highProteinOnly)}>
          Białko ≥ {proteinFloor} g{highProteinOnly && ' ✕'}
        </Chip>
        <Chip active={stock === 'have'} onClick={() => setStock(stock === 'have' ? 'any' : 'have')}>
          Mam wszystko{stock === 'have' && ' ✕'}
        </Chip>
        {canEdit && chatHealth?.enabled && (
          <Button
            variant="dark"
            size="sm"
            onClick={() =>
              requestChat(
                `Zostało mi dziś ${budgetKcal} kcal${budgetProtein ? ` i ${budgetProtein} g białka` : ''} — zaproponuj coś z naszych przepisów albo ze spiżarni.`,
              )
            }
          >
            ✦ Zapytaj Sous
          </Button>
        )}
      </div>
    </div>
  )

  const tiles = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <Tile dark eyebrow="Nie wiem, co zjeść" title={'Losuj obiad\u00A0→'} onClick={() => nav('/random')} />
      <Tile eyebrow="Bez zakupów" title={'Z tego, co\u00A0mam\u00A0→'} onClick={() => setStock('have')} />
    </div>
  )

  const searchPlaceholder = 'Szukaj po nazwie, składniku, tagu lub źródle'

  return (
    <div style={{ ...pad, maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 16 : 24 }}>
      <PageTitle
        title="Przepisy"
        count={counts.all || undefined}
        right={
          isMobile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {canEdit && <Button variant="outline" size="sm" onClick={() => nav('/add')}>+ Dodaj</Button>}
              <SousButton variant="header" />
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <SearchField value={query} onChange={setQuery} placeholder={searchPlaceholder} style={{ width: 380 }} />
              {canEdit && <Button onClick={() => nav('/add')}>+ Dodaj przepis</Button>}
            </div>
          )
        }
      />

      <ZmierzchLink />
      {canEdit && <FirstStepsCard />}

      {isMobile ? (
        <>
          <SearchField value={query} onChange={setQuery} placeholder={searchPlaceholder} />
          {browsing && tiles}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tabs}
            {mobileFilters}
            {activeFilterChips}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ borderBottom: '1px solid var(--rule)' }}>{tabs}</div>
          {desktopFilters}
          {activeFilterChips}
        </div>
      )}

      {budgetBanner}

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
                <Row key={r.id} r={r} first={i === 0} shortfall={shortfall} showProtein={budgetKcal !== null} onOpen={() => open(r)} onToggleFav={toggleFav} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, borderTop: browsing ? '1px solid var(--rule)' : undefined, paddingTop: browsing ? 20 : 0 }}>
              {browsing && <Eyebrow>{featuredIds ? `Pozostałe przepisy · ${gridView.length}` : `Wszystkie przepisy · ${view.length}`}</Eyebrow>}
              {!browsing && <Eyebrow>{view.length} z {counts.all}</Eyebrow>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', columnGap: 24, rowGap: 32 }}>
                {gridVisibleItems.map((r) => <GridCard key={r.id} r={r} shortfall={shortfall} showProtein={budgetKcal !== null} onOpen={() => open(r)} onToggleFav={toggleFav} />)}
              </div>
            </div>
          )}

          <div ref={isMobile ? sentinel : gridSentinel} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '8px 0 0', font: mono(12), color: 'var(--text-3)' }}>
            <span role="status">
              Wyświetlono {isMobile ? visibleItems.length : gridVisibleItems.length} z {isMobile ? view.length : gridView.length} przepisów
            </span>
            {(isMobile ? hasMore : gridHasMore) && <Chip onClick={isMobile ? loadMore : gridLoadMore}>Pokaż więcej</Chip>}
          </div>
        </>
      )}

      <Sheet
        open={filterSheet}
        onClose={() => setFilterSheet(false)}
        title="Filtry"
        width={540}
        footer={
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="outline" size={isMobile ? 'xl' : 'lg'} style={{ flex: 1 }} onClick={clearToolbarFilters}>Wyczyść</Button>
            <Button size={isMobile ? 'xl' : 'lg'} style={{ flex: 1.4 }} onClick={() => setFilterSheet(false)}>Pokaż {view.length}</Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <ChipGroup label="Szybkie">
            <Chip active={favoriteOnly} onClick={() => setFavoriteOnly(!favoriteOnly)}>★ Ulubione</Chip>
            <Chip active={airFryerOnly} onClick={() => setAirFryerOnly(!airFryerOnly)}>Frytkownica</Chip>
          </ChipGroup>
          <ChipGroup label="Pochodzenie">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>Wszystkie · {counts.all}</Chip>
            <Chip active={filter === 'ai'} onClick={() => setFilter('ai')}>{sourceLabel.ai} · {counts.ai}</Chip>
            <Chip active={filter === 'web'} onClick={() => setFilter('web')}>{sourceLabel.web} · {counts.web}</Chip>
            <Chip active={filter === 'manual'} onClick={() => setFilter('manual')}>{sourceLabel.manual} · {counts.manual}</Chip>
          </ChipGroup>
          {origins.length > 0 && (
            <ChipGroup label="Książka lub strona">
              <Chip active={origin === null} onClick={() => setOrigin(null)}>Wszystkie</Chip>
              {origins.map((o) => <Chip key={o.key} active={origin === o.key} onClick={() => setOrigin(o.key)}>{o.label} · {o.count}</Chip>)}
            </ChipGroup>
          )}
          {availableDishTypes.length > 0 && (
            <ChipGroup label="Kategoria">
              <Chip active={dish === 'all'} onClick={() => setDish('all')}>Wszystkie</Chip>
              {availableDishTypes.map((d) => <Chip key={d.key} active={dish === d.key} onClick={() => setDish(d.key)}>{dishTypeLabel[d.key]} · {d.count}</Chip>)}
            </ChipGroup>
          )}
          {availableCuisines.length > 0 && (
            <ChipGroup label="Kuchnia">
              <Chip active={cuisine === 'all'} onClick={() => setCuisine('all')}>Wszystkie</Chip>
              {availableCuisines.map((c) => <Chip key={c.key} active={cuisine === c.key} onClick={() => setCuisine(c.key)}>{cuisineLabel[c.key]} · {c.count}</Chip>)}
            </ChipGroup>
          )}
          {allTags.length > 0 && (
            <ChipGroup label="Tagi">
              <Chip active={tag === null} onClick={() => setTag(null)}>Wszystkie</Chip>
              {allTags.map((t) => <Chip key={t.tag} active={tag === t.tag} onClick={() => setTag(t.tag)}>#{t.tag} · {t.count}</Chip>)}
            </ChipGroup>
          )}
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
          </ChipGroup>
          <ChipGroup label="Sortowanie">
            {SORT_OPTIONS.map((o) => <Chip key={o.key} active={sort === o.key} onClick={() => setSort(o.key)}>{o.label}</Chip>)}
          </ChipGroup>
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
        background: dark ? 'var(--ink)' : 'var(--accent-soft)',
        color: dark ? 'var(--on-ink)' : 'var(--text)',
      }}
    >
      <Eyebrow tone={dark ? 'light' : 'muted'} style={dark ? undefined : { color: 'var(--accent-soft-text)' }}>{eyebrow}</Eyebrow>
      <span style={{ fontFamily: 'var(--serif)', fontSize: isMobile ? 20 : 24, lineHeight: 1.08 }}>{title}</span>
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
function Row({ r, onOpen, first, shortfall, showProtein, heading = true, onToggleFav }: {
  r: RecipeListItem
  onOpen: () => void
  first?: boolean
  shortfall?: boolean
  showProtein?: boolean
  heading?: boolean
  onToggleFav?: (r: RecipeListItem) => void
}) {
  const Title = heading ? 'h3' : 'span'
  const isMobile = useIsMobile()
  const size = isMobile ? 76 : 84
  const tags = r.tags ?? []
  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex',
        gap: isMobile ? 14 : 16,
        padding: '14px 0',
        cursor: 'pointer',
        alignItems: 'center',
        borderBottom: isMobile ? undefined : '1px solid var(--border)',
        borderTop: isMobile && !first ? '1px solid var(--border)' : undefined,
      }}
    >
      <RecipeThumb r={r} letterSize={30} style={{ width: size, height: size, borderRadius: 10 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, minWidth: 0 }}>
        <Eyebrow size={10.5}>{sourceEyebrow(r)}</Eyebrow>
        <Title style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 19 : 20, lineHeight: 1.15 }}>
          {r.isFavorite && !onToggleFav && <span style={{ color: 'var(--gold)', marginRight: 5 }}>★</span>}
          {r.title}
        </Title>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10, font: mono(12), color: 'var(--text-2)' }}>
          <span>{r.time} min</span>
          {showProtein && r.kcal != null && <span>~{r.kcal} kcal</span>}
          {showProtein && r.protein != null && <span>B {formatGrams(r.protein)}</span>}
          <StockNote toBuy={r.toBuyCount} short={shortfall} />
        </span>
        {tags.length > 0 && (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, font: mono(11), color: 'var(--text-3)' }}>
            {tags.slice(0, 3).map((t) => <span key={t}>#{t}</span>)}
          </span>
        )}
      </div>
      {onToggleFav && (
        <button
          type="button"
          aria-label={r.isFavorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
          aria-pressed={r.isFavorite}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFav(r)
          }}
          style={{
            flex: '0 0 auto',
            width: 36,
            height: 36,
            border: 0,
            background: 'transparent',
            color: r.isFavorite ? 'var(--gold)' : 'var(--border-2)',
            cursor: 'pointer',
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {r.isFavorite ? '★' : '☆'}
        </button>
      )}
    </div>
  )
}

function GridCard({ r, onOpen, shortfall, showProtein, onToggleFav }: {
  r: RecipeListItem
  onOpen: () => void
  shortfall?: boolean
  showProtein?: boolean
  onToggleFav?: (r: RecipeListItem) => void
}) {
  const tags = r.tags ?? []
  return (
    <div onClick={onOpen} style={{ display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer', minWidth: 0 }}>
      <div style={{ position: 'relative' }}>
        <RecipeThumb r={r} letterSize={56} style={{ height: 170, borderRadius: 12 }} />
        {(onToggleFav || r.isFavorite) && (
          <button
            type="button"
            disabled={!onToggleFav}
            aria-label={r.isFavorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
            aria-pressed={r.isFavorite}
            onClick={(e) => {
              e.stopPropagation()
              onToggleFav?.(r)
            }}
            style={{
              position: 'absolute',
              right: 10,
              top: 10,
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 0,
              background: 'var(--surface)',
              color: r.isFavorite ? 'var(--gold)' : 'var(--text-3)',
              opacity: r.isFavorite ? 0.96 : 0.78,
              cursor: onToggleFav ? 'pointer' : 'default',
              fontSize: 15,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {r.isFavorite ? '★' : '☆'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <Eyebrow size={10.5}>{sourceEyebrow(r)}</Eyebrow>
        <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 19, lineHeight: 1.2 }}>{r.title}</h3>
        <span style={{ display: 'flex', flexWrap: 'wrap', columnGap: 10, font: mono(12), color: 'var(--text-2)' }}>
          <span>{r.time} min</span>
          {r.kcal != null && <span>~{r.kcal} kcal</span>}
          {showProtein && r.protein != null && <span>B {formatGrams(r.protein)}</span>}
          <StockNote toBuy={r.toBuyCount} short={shortfall} />
        </span>
        {tags.length > 0 && (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, font: mono(11), color: 'var(--text-3)' }}>
            {tags.slice(0, 3).map((t) => <span key={t}>#{t}</span>)}
          </span>
        )}
      </div>
    </div>
  )
}
