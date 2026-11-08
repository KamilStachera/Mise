import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useExercises, type Equipment, type ExerciseLevel, type ExerciseListItem, type Muscle } from '../../api/training'
import { FilterDropdown } from '../../components/FilterDropdown'
import { BodyMap } from '../../components/training/BodyMap'
import { ExerciseSheet } from '../../components/training/ExerciseSheet'
import { Chip, PageTitle, SearchField, Sheet, mono, sans, usePagePad } from '../../components/ui'
import { EQUIPMENT, EXERCISE_LEVELS, MUSCLES, equipmentLabel, exerciseLevelLabel, muscleLabel } from '../../lib/labels'
import { useInfiniteScroll } from '../../lib/useInfiniteScroll'
import { useIsMobile } from '../../lib/useIsMobile'
import { useSessionState } from '../../lib/useSessionState'

const KEY = 'pichci-exercises:'
const EMPTY: ExerciseListItem[] = []
const oneOfOrNull = (allowed: readonly string[]) => (v: unknown) => v === null || allowed.includes(v as string)

/**
 * Ćwiczenia: the shared exercise catalog (free-exercise-db + Polish descriptions agents add).
 * Filter by muscle (dropdown or by tapping the silhouette), equipment, level, home kit, video.
 * The open exercise lives in ?e= so it can be linked and survives a reload.
 */
export function CatalogView() {
  const pad = usePagePad()
  const isMobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const openId = params.get('e')

  const [query, setQuery] = useSessionState(`${KEY}q`, '', (v) => typeof v === 'string')
  const [muscle, setMuscle] = useSessionState<Muscle | null>(`${KEY}muscle`, null, oneOfOrNull(MUSCLES))
  const [equipment, setEquipment] = useSessionState<Equipment | null>(`${KEY}equipment`, null, oneOfOrNull(EQUIPMENT))
  const [level, setLevel] = useSessionState<ExerciseLevel | null>(`${KEY}level`, null, oneOfOrNull(EXERCISE_LEVELS))
  const [homeOnly, setHomeOnly] = useSessionState(`${KEY}home`, false, (v) => typeof v === 'boolean')
  const [videoOnly, setVideoOnly] = useSessionState(`${KEY}video`, false, (v) => typeof v === 'boolean')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [mapSheet, setMapSheet] = useState(false)
  const q = useDebounced(query, 200)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!(e.target instanceof Element) || !e.target.closest('[data-dd]')) setOpenMenu(null)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  const { data, isLoading, isError } = useExercises({
    q, muscle, level, equipment: equipment ? [equipment] : undefined,
    location: homeOnly ? 'home' : null, video: videoOnly,
  })
  const items = data?.items ?? EMPTY
  const resetKey = JSON.stringify([q, muscle, equipment, level, homeOnly, videoOnly])
  const { visibleItems, sentinel, hasMore } = useInfiniteScroll(items, resetKey, `${KEY}page`)

  const open = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('e', id)
    else next.delete('e')
    setParams(next, { replace: !id })
  }
  const menu = (key: string) => ({ open: openMenu === key, onToggle: () => setOpenMenu((m) => (m === key ? null : key)) })
  const pick = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setOpenMenu(null) }
  const pickMuscle = (m: Muscle) => { setMuscle(muscle === m ? null : m); setMapSheet(false) }
  const filtersOn = [muscle, equipment, level].filter(Boolean).length + (homeOnly ? 1 : 0) + (videoOnly ? 1 : 0)
  const clear = () => { setMuscle(null); setEquipment(null); setLevel(null); setHomeOnly(false); setVideoOnly(false) }

  const filters = (
    <div className={isMobile ? 'no-scrollbar' : undefined} style={{
      display: 'flex', gap: 8, alignItems: 'center',
      ...(isMobile ? { overflowX: 'auto', margin: '0 -20px', padding: '0 20px' } : { flexWrap: 'wrap' }),
    }}>
      {isMobile && (
        <Chip active={!!muscle} onClick={() => setMapSheet(true)}>
          {muscle ? `${muscleLabel[muscle]} ✕` : 'Partia mięśni'}
        </Chip>
      )}
      {!isMobile && (
        <FilterDropdown
          {...menu('muscle')}
          label={muscle ? muscleLabel[muscle] : 'Partia mięśni'}
          active={!!muscle}
          options={[
            { label: 'Wszystkie partie', selected: muscle === null, onSelect: () => pick(setMuscle)(null) },
            ...MUSCLES.map((m) => ({ label: muscleLabel[m], selected: muscle === m, onSelect: () => pick(setMuscle)(m) })),
          ]}
        />
      )}
      <Chip active={homeOnly} onClick={() => setHomeOnly(!homeOnly)}>Do domu</Chip>
      <Chip active={videoOnly} onClick={() => setVideoOnly(!videoOnly)}>Z filmem</Chip>
      <FilterDropdown
        {...menu('equipment')}
        label={equipment ? equipmentLabel[equipment] : 'Sprzęt'}
        active={!!equipment}
        options={[
          { label: 'Dowolny sprzęt', selected: equipment === null, onSelect: () => pick(setEquipment)(null) },
          ...EQUIPMENT.map((e) => ({ label: equipmentLabel[e], selected: equipment === e, onSelect: () => pick(setEquipment)(e) })),
        ]}
      />
      <FilterDropdown
        {...menu('level')}
        label={level ? exerciseLevelLabel[level] : 'Poziom'}
        active={!!level}
        options={[
          { label: 'Każdy poziom', selected: level === null, onSelect: () => pick(setLevel)(null) },
          ...EXERCISE_LEVELS.map((l) => ({ label: exerciseLevelLabel[l], selected: level === l, onSelect: () => pick(setLevel)(l) })),
        ]}
      />
      {filtersOn > 0 && (
        <button type="button" onClick={clear} style={{ border: 0, background: 'transparent', cursor: 'pointer', font: sans(13, 600), color: 'var(--accent-text)', padding: '7px 4px', flexShrink: 0 }}>
          Wyczyść
        </button>
      )}
    </div>
  )

  const list = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {isError && <p style={{ font: sans(14), color: 'var(--text-2)' }}>Nie udało się wczytać ćwiczeń.</p>}
      {!isLoading && !isError && items.length === 0 && (
        <p style={{ font: sans(14.5), color: 'var(--text-2)', padding: '24px 0' }}>Nic nie pasuje do tych filtrów.</p>
      )}
      {visibleItems.map((ex) => <ExerciseRow key={ex.id} ex={ex} onOpen={() => open(ex.id)} />)}
      {hasMore && <div ref={sentinel} style={{ height: 1 }} />}
    </div>
  )

  const coverage = data && (
    <span style={{ font: mono(11.5, 500), color: 'var(--text-3)' }}>
      Opisane po polsku: {data.enrichedTotal} / {data.catalogTotal}
    </span>
  )

  return (
    <div style={{ ...pad, maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 16 : 24 }}>
      <PageTitle
        title="Ćwiczenia"
        count={data?.total}
        sub={coverage}
        right={!isMobile && <SearchField value={query} onChange={setQuery} placeholder="Szukaj: przysiad, plank, hip thrust…" style={{ width: 340 }} />}
      />
      {isMobile && <SearchField value={query} onChange={setQuery} placeholder="Szukaj: przysiad, plank…" />}

      {isMobile ? (
        <>
          {filters}
          {list}
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 40, alignItems: 'start' }}>
          <aside style={{ position: 'sticky', top: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ font: mono(10.5, 500), letterSpacing: '.1em', color: 'var(--text-3)' }}>DOTKNIJ PARTII</span>
            <BodyMap primary={muscle ? [muscle] : []} onPick={pickMuscle} height={250} legend={false} />
            {muscle && (
              <button type="button" onClick={() => setMuscle(null)} style={{ border: 0, background: 'transparent', cursor: 'pointer', font: sans(13, 600), color: 'var(--accent-text)', textAlign: 'center' }}>
                {muscleLabel[muscle]} ✕
              </button>
            )}
          </aside>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ borderBottom: '1px solid var(--rule)', paddingBottom: 10 }}>{filters}</div>
            {list}
          </div>
        </div>
      )}

      <Sheet open={mapSheet} onClose={() => setMapSheet(false)} title="Partia mięśni">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <BodyMap primary={muscle ? [muscle] : []} onPick={pickMuscle} height={300} legend={false} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {MUSCLES.map((m) => (
              <Chip key={m} active={muscle === m} onClick={() => pickMuscle(m)}>{muscleLabel[m]}</Chip>
            ))}
          </div>
        </div>
      </Sheet>

      <ExerciseSheet id={openId} onClose={() => open(null)} />
    </div>
  )
}

function ExerciseRow({ ex, onOpen }: { ex: ExerciseListItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', border: 0,
        borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer',
        textAlign: 'left', color: 'var(--text)', width: '100%',
      }}
    >
      <div style={{ width: 72, height: 48, flex: '0 0 72px', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {ex.thumbnailUrl && <img src={ex.thumbnailUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 18, lineHeight: 1.2 }}>{ex.name}</span>
        <span style={{ font: sans(12.5), color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[ex.primaryMuscles.map((m) => muscleLabel[m]).join(', '), equipmentLabel[ex.equipment], exerciseLevelLabel[ex.level]].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {ex.hasVideo && <Badge color="var(--accent-text)">▶ FILM</Badge>}
        {!ex.enriched && <Badge color="var(--text-3)">EN</Badge>}
      </div>
    </button>
  )
}

function Badge({ color, children }: { color: string; children: string }) {
  return <span style={{ font: mono(10, 600), letterSpacing: '.06em', color, border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px' }}>{children}</span>
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}
