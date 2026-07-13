import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useRecipes } from '../api/hooks'
import type { Cuisine, DishType, RecipeListItem, Source } from '../api/client'
import { gradient } from '../lib/colors'
import { CUISINES, DIFFICULTIES, DISH_TYPES, cuisineLabel, dishTypeLabel, recipeCountLabel, sourceBadge } from '../lib/labels'
import { SearchIcon, ClockIcon, ServingsIcon, PlusIcon, FilterIcon, SortIcon } from '../components/icons'
import { FilterDropdown } from '../components/FilterDropdown'
import { useIsMobile } from '../lib/useIsMobile'

function chip(active: boolean): CSSProperties {
  return {
    border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
    background: active ? 'var(--accent)' : 'var(--card)',
    color: active ? '#fff' : 'var(--text-2)',
    borderRadius: 20,
    padding: '8px 14px',
    font: "500 13px 'Hanken Grotesk'",
    cursor: 'pointer',
    transition: 'all .14s',
  }
}

type Filter = 'all' | Source
type TimeBucket = '15' | '30' | '60' | '60plus'
type SortMode = 'alpha' | 'newest' | 'quickest' | 'missing'

const TIME_BUCKETS: { key: TimeBucket; label: string }[] = [
  { key: '15', label: '≤ 15 min' },
  { key: '30', label: '≤ 30 min' },
  { key: '60', label: '≤ 60 min' },
  { key: '60plus', label: '60+ min' },
]

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: 'newest', label: 'Najnowsze' },
  { key: 'alpha', label: 'A–Z' },
  { key: 'quickest', label: 'Najszybsze' },
  { key: 'missing', label: 'Najmniej brakuje' },
]

function inTimeBucket(time: number, bucket: TimeBucket | null): boolean {
  if (bucket === null) return true
  if (bucket === '60plus') return time > 60
  return time <= Number(bucket)
}

export function Library() {
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const { canEdit } = useAuth()
  const { data: recipes = [], isLoading } = useRecipes('all', '')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [dish, setDish] = useState<DishType | 'all'>('all')
  const [cuisine, setCuisine] = useState<Cuisine | 'all'>('all')
  const [timeBucket, setTimeBucket] = useState<TimeBucket | null>(null)
  const [difficulty, setDifficulty] = useState<string>('all')
  const [canCookNow, setCanCookNow] = useState(false)
  const [almostReady, setAlmostReady] = useState(false)
  const [airFryerOnly, setAirFryerOnly] = useState(false)
  const [sort, setSort] = useState<SortMode>('newest')
  const [openMenu, setOpenMenu] = useState<string | null>(null)

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

  const view = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = recipes
      .filter((r) => filter === 'all' || r.source === filter)
      .filter((r) => dish === 'all' || r.dishType === dish)
      .filter((r) => cuisine === 'all' || r.cuisine === cuisine)
      .filter((r) => inTimeBucket(r.time, timeBucket))
      .filter((r) => difficulty === 'all' || r.difficulty === difficulty)
      .filter((r) => !canCookNow || r.toBuyCount === 0)
      .filter((r) => !almostReady || (r.toBuyCount >= 1 && r.toBuyCount <= 2))
      .filter((r) => !airFryerOnly || r.usesAirFryer)
      .filter((r) => !q || r.title.toLowerCase().includes(q))
    // 'alpha' keeps the server order — it is already Polish-collated.
    if (sort === 'newest') filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (sort === 'quickest') filtered.sort((a, b) => a.time - b.time)
    if (sort === 'missing')
      filtered.sort((a, b) => a.toBuyCount - b.toBuyCount || b.createdAt.localeCompare(a.createdAt))
    return filtered
  }, [recipes, filter, dish, cuisine, timeBucket, difficulty, canCookNow, almostReady, airFryerOnly, query, sort])

  // The toolbar's "clear" covers only what the toolbar owns (design semantics);
  // source chips and search have their own affordances.
  const toolbarFiltersActive =
    dish !== 'all' || cuisine !== 'all' || timeBucket !== null || difficulty !== 'all' ||
    canCookNow || almostReady || airFryerOnly
  const filtersActive = toolbarFiltersActive || filter !== 'all' || query.trim() !== ''

  function clearToolbarFilters() {
    setDish('all')
    setCuisine('all')
    setTimeBucket(null)
    setDifficulty('all')
    setCanCookNow(false)
    setAlmostReady(false)
    setAirFryerOnly(false)
    setOpenMenu(null)
  }

  function clearAllFilters() {
    clearToolbarFilters()
    setFilter('all')
    setQuery('')
  }

  function toggleMenu(key: string) {
    setOpenMenu((m) => (m === key ? null : key))
  }

  function pick<T>(setter: (v: T) => void): (v: T) => void {
    return (v) => {
      setter(v)
      setOpenMenu(null)
    }
  }

  const pickDish = pick(setDish)
  const pickCuisine = pick(setCuisine)
  const pickTime = pick(setTimeBucket)
  const pickDifficulty = pick(setDifficulty)
  const pickSort = pick(setSort)

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: isMobile ? '22px 14px 40px' : '38px 42px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 6, flexWrap: 'wrap' }}>
        <div>
          <div style={{ font: "600 11px 'Hanken Grotesk'", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 7 }}>
            Twoja kolekcja
          </div>
          <h1 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 38, lineHeight: 1.05, margin: 0, color: 'var(--text)' }}>
            Biblioteka przepisów
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 11, padding: '9px 13px', width: isMobile ? 170 : 248 }}>
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj przepisów…"
              style={{ border: 'none', background: 'transparent', flex: 1, minWidth: 0, font: "400 14px 'Hanken Grotesk'", color: 'var(--text)' }}
            />
          </div>
          {canEdit && (
            <button
              onClick={() => nav('/add')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 11, padding: '10px 14px', font: "600 13.5px 'Hanken Grotesk'", cursor: 'pointer' }}
            >
              <PlusIcon /> Dodaj
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '22px 0 12px', flexWrap: 'wrap' }}>
        <button onClick={() => setFilter('all')} style={chip(filter === 'all')}>
          Wszystkie <span style={{ opacity: 0.55, marginLeft: 2 }}>{counts.all}</span>
        </button>
        <button onClick={() => setFilter('ai')} style={chip(filter === 'ai')}>
          ✦ Od AI <span style={{ opacity: 0.55, marginLeft: 2 }}>{counts.ai}</span>
        </button>
        <button onClick={() => setFilter('web')} style={chip(filter === 'web')}>
          Sieć i książki <span style={{ opacity: 0.55, marginLeft: 2 }}>{counts.web}</span>
        </button>
        <button onClick={() => setFilter('manual')} style={chip(filter === 'manual')}>
          Moje własne <span style={{ opacity: 0.55, marginLeft: 2 }}>{counts.manual}</span>
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', margin: '0 0 10px', padding: '6px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 13 }}>
        <FilterIcon style={{ margin: '0 5px 0 4px', flex: '0 0 auto' }} />
        <FilterDropdown
          open={openMenu === 'dish'}
          onToggle={() => toggleMenu('dish')}
          label={dish === 'all' ? 'Kategoria' : dishTypeLabel[dish]}
          active={dish !== 'all'}
          options={[
            { label: 'Wszystkie kategorie', selected: dish === 'all', onSelect: () => pickDish('all') },
            ...DISH_TYPES.map((d) => ({ label: dishTypeLabel[d], selected: dish === d, onSelect: () => pickDish(d) })),
          ]}
        />
        <FilterDropdown
          open={openMenu === 'cuisine'}
          onToggle={() => toggleMenu('cuisine')}
          label={cuisine === 'all' ? 'Kuchnia' : cuisineLabel[cuisine]}
          active={cuisine !== 'all'}
          options={[
            { label: 'Wszystkie kuchnie', selected: cuisine === 'all', onSelect: () => pickCuisine('all') },
            ...CUISINES.map((c) => ({ label: cuisineLabel[c], selected: cuisine === c, onSelect: () => pickCuisine(c) })),
          ]}
        />
        <FilterDropdown
          open={openMenu === 'time'}
          onToggle={() => toggleMenu('time')}
          label={timeBucket === null ? 'Czas' : TIME_BUCKETS.find((b) => b.key === timeBucket)!.label}
          active={timeBucket !== null}
          options={[
            { label: 'Dowolny czas', selected: timeBucket === null, onSelect: () => pickTime(null) },
            ...TIME_BUCKETS.map((b) => ({ label: b.label, selected: timeBucket === b.key, onSelect: () => pickTime(b.key) })),
          ]}
        />
        <FilterDropdown
          open={openMenu === 'difficulty'}
          onToggle={() => toggleMenu('difficulty')}
          label={difficulty === 'all' ? 'Trudność' : difficulty}
          active={difficulty !== 'all'}
          options={[
            { label: 'Dowolna trudność', selected: difficulty === 'all', onSelect: () => pickDifficulty('all') },
            ...DIFFICULTIES.map((d) => ({ label: d, selected: difficulty === d, onSelect: () => pickDifficulty(d) })),
          ]}
        />
        <span style={{ width: 1, height: 18, background: 'var(--border-2)', margin: '0 5px', flex: '0 0 auto' }} />
        <button
          onClick={() => setCanCookNow(!canCookNow)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            border: 'none',
            background: canCookNow ? 'rgba(110,122,82,.16)' : 'transparent',
            color: canCookNow ? 'var(--sage)' : 'var(--text)',
            borderRadius: 9,
            padding: '7px 11px',
            font: "600 13px 'Hanken Grotesk'",
            cursor: 'pointer',
            transition: 'background .13s',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: canCookNow ? 'var(--sage)' : 'var(--border-2)', transition: 'background .13s' }} />
          Mam składniki
        </button>
        <button
          onClick={() => setAlmostReady(!almostReady)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            border: 'none',
            background: almostReady ? 'var(--accent-soft)' : 'transparent',
            color: almostReady ? 'var(--accent-deep)' : 'var(--text)',
            borderRadius: 9,
            padding: '7px 11px',
            font: "600 13px 'Hanken Grotesk'",
            cursor: 'pointer',
            transition: 'background .13s',
            whiteSpace: 'nowrap',
          }}
          title="Brakuje najwyżej 1–2 składników"
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: almostReady ? 'var(--accent)' : 'var(--border-2)', transition: 'background .13s' }} />
          Prawie kompletne
        </button>
        <button
          onClick={() => setAirFryerOnly(!airFryerOnly)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            border: 'none',
            background: airFryerOnly ? 'rgba(189,139,44,.16)' : 'transparent',
            color: airFryerOnly ? 'var(--gold)' : 'var(--text)',
            borderRadius: 9,
            padding: '7px 11px',
            font: "600 13px 'Hanken Grotesk'",
            cursor: 'pointer',
            transition: 'background .13s',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: airFryerOnly ? 'var(--gold)' : 'var(--border-2)', transition: 'background .13s' }} />
          Frytkownica
        </button>
        <div style={{ flex: 1 }} />
        {toolbarFiltersActive && (
          <button
            onClick={clearToolbarFilters}
            style={{ border: 'none', background: 'transparent', color: 'var(--accent)', font: "600 12.5px 'Hanken Grotesk'", cursor: 'pointer', padding: '7px 9px', borderRadius: 8 }}
          >
            Wyczyść filtry
          </button>
        )}
        <FilterDropdown
          open={openMenu === 'sort'}
          onToggle={() => toggleMenu('sort')}
          label={SORT_OPTIONS.find((o) => o.key === sort)!.label}
          active={false}
          muted
          align="right"
          leadingIcon={<SortIcon />}
          options={SORT_OPTIONS.map((o) => ({ label: o.label, selected: sort === o.key, onSelect: () => pickSort(o.key) }))}
        />
      </div>

      <div style={{ font: "500 12.5px 'Hanken Grotesk'", color: 'var(--text-3)', margin: '0 0 16px', paddingLeft: 2 }}>
        {view.length === counts.all ? recipeCountLabel(view.length) : `${view.length} z ${counts.all} przepisów`}
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-3)', padding: 40 }}>Ładowanie…</div>
      ) : view.length === 0 ? (
        filtersActive ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center', padding: '54px 20px', border: '1.5px dashed var(--border-2)', borderRadius: 16, background: 'var(--surface)' }}>
            <div style={{ fontFamily: "'Spectral', serif", fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>Nic nie pasuje do tych filtrów</div>
            <div style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Poluzuj któryś filtr — albo poproś Sous o coś, co pasuje.</div>
            <button
              onClick={clearAllFilters}
              style={{ marginTop: 10, border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '9px 16px', font: "600 13px 'Hanken Grotesk'", cursor: 'pointer' }}
            >
              Wyczyść wszystkie filtry
            </button>
          </div>
        ) : (
          <div style={{ color: 'var(--text-3)', padding: 40 }}>Nie ma tu jeszcze przepisów.</div>
        )
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))', gap: 'clamp(12px, 2.5vw, 20px)' }}>
          {view.map((r) => (
            <Card key={r.id} r={r} showShortfall={almostReady || sort === 'missing'} onOpen={() => nav(`/recipe/${r.id}`)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Card({ r, showShortfall = false, onOpen }: { r: RecipeListItem; showShortfall?: boolean; onOpen: () => void }) {
  const allIn = r.toBuyCount === 0
  return (
    <div
      onClick={onOpen}
      style={{ cursor: 'pointer', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', transition: 'transform .16s, box-shadow .16s' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)'
        e.currentTarget.style.boxShadow = '0 10px 24px rgba(80,60,30,.13)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{ position: 'relative', height: 132, background: gradient(r.tint), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {r.imageUrl ? (
          <img src={r.imageUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontFamily: "'Spectral', serif", fontSize: 60, fontWeight: 500, color: 'rgba(255,255,255,.9)', lineHeight: 1 }}>
            {r.title[0]}
          </span>
        )}
        <span style={{ position: 'absolute', top: 11, left: 11, font: "700 10px 'Hanken Grotesk'", letterSpacing: '.08em', padding: '4px 8px', borderRadius: 7, background: 'rgba(255,255,255,.92)', color: sourceBadge[r.source].col }}>
          {sourceBadge[r.source].label}
        </span>
      </div>
      <div style={{ padding: '15px 16px 17px' }}>
        <h3 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 18, lineHeight: 1.18, margin: '0 0 9px', color: 'var(--text)' }}>
          {r.title}
        </h3>
        {(r.dishType || r.cuisine) && (
          <div style={{ font: "500 11.5px 'Hanken Grotesk'", color: 'var(--text-3)', margin: '-4px 0 9px' }}>
            {[r.dishType && dishTypeLabel[r.dishType], r.cuisine && `kuchnia ${cuisineLabel[r.cuisine]}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, font: "500 12.5px 'Hanken Grotesk'", color: 'var(--text-2)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ClockIcon />
            {r.time} min
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ServingsIcon />
            {r.servings}
          </span>
          {r.kcal != null && (
            <span style={{ font: "500 11.5px 'Spline Sans Mono'", color: 'var(--text-3)' }}>~{r.kcal} kcal</span>
          )}
          <span
            style={{
              marginLeft: 'auto',
              font: "600 11.5px 'Hanken Grotesk'",
              color: allIn ? 'var(--sage)' : 'var(--accent)',
              background: allIn ? 'rgba(110,122,82,.12)' : 'var(--accent-soft)',
              padding: '3px 9px',
              borderRadius: 7,
            }}
          >
            {allIn ? 'Wszystko jest' : showShortfall ? `brakuje ${r.toBuyCount}` : `${r.toBuyCount} do kupienia`}
          </span>
        </div>
      </div>
    </div>
  )
}
