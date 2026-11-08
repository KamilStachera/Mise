import { useEffect, useState } from 'react'
import { useExercises, type ExerciseListItem, type Muscle } from '../../api/training'
import { MUSCLES, equipmentLabel, exerciseLevelLabel, muscleLabel } from '../../lib/labels'
import { Chip, SearchField, Sheet, mono, sans } from '../ui'

/** Pick one catalog exercise (the day editor's "+ ćwiczenie"). */
export function ExercisePicker({ open, onClose, onPick, homeFirst }: {
  open: boolean
  onClose: () => void
  onPick: (e: ExerciseListItem) => void
  homeFirst?: boolean
}) {
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<Muscle | null>(null)
  const [home, setHome] = useState(!!homeFirst)
  useEffect(() => {
    const t = window.setTimeout(() => setQ(query), 200)
    return () => window.clearTimeout(t)
  }, [query])
  const { data, isLoading } = useExercises({ q, muscle, location: home ? 'home' : null })
  const items = (data?.items ?? []).slice(0, 60)

  return (
    <Sheet open={open} onClose={onClose} title="Dodaj ćwiczenie" width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SearchField value={query} onChange={setQuery} placeholder="Szukaj: przysiad, hip thrust…" />
        <div className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
          <Chip active={home} onClick={() => setHome(!home)}>Do domu</Chip>
          {MUSCLES.map((m) => (
            <Chip key={m} active={muscle === m} onClick={() => setMuscle(muscle === m ? null : m)}>{muscleLabel[m]}</Chip>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {isLoading && <p style={{ font: sans(14), color: 'var(--text-3)' }}>Szukam…</p>}
          {items.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onPick(e)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
            >
              <span style={{ width: 54, height: 36, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                {e.thumbnailUrl && <img src={e.thumbnailUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ font: sans(14.5, 600) }}>
                  {e.name}
                  {e.hasVideo && <span style={{ font: mono(10, 600), color: 'var(--accent-text)', marginLeft: 6 }}>▶</span>}
                </span>
                <span style={{ font: sans(12), color: 'var(--text-3)' }}>
                  {[e.primaryMuscles.map((m) => muscleLabel[m]).join(', '), equipmentLabel[e.equipment], exerciseLevelLabel[e.level]].join(' · ')}
                </span>
              </span>
            </button>
          ))}
          {data && data.total > items.length && (
            <p style={{ font: sans(12.5), color: 'var(--text-3)', margin: '10px 0 0' }}>
              Pokazuję {items.length} z {data.total} — zawęź wyszukiwanie.
            </p>
          )}
        </div>
      </div>
    </Sheet>
  )
}
