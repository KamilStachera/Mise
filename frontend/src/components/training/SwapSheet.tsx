import { useState } from 'react'
import { errorText } from '../../api/client'
import {
  useExerciseAlternatives, usePatchProgramExercise,
  type ExerciseListItem, type ProgramExercise, type SwapDirection, type SwapLocation, type TrainingLocation,
} from '../../api/training'
import { equipmentLabel, exerciseLevelLabel, muscleLabel } from '../../lib/labels'
import { showToast } from '../../lib/toastBus'
import { Chip, Segmented, Sheet, Toggle, mono, sans } from '../ui'
import { ExerciseSheet } from './ExerciseSheet'

/**
 * "Zamień ćwiczenie" for one plan slot: alternatives sharing a primary muscle, easier / similar /
 * harder, filtered by where she trains. By default the swap also applies to the following weeks
 * (same day name), because a disliked exercise is usually disliked for good.
 */
export function SwapSheet({ slot, dayLocation, onClose }: {
  slot: ProgramExercise | null
  dayLocation: TrainingLocation
  onClose: () => void
}) {
  const [direction, setDirection] = useState<SwapDirection>('similar')
  const [location, setLocation] = useState<SwapLocation>(dayLocation === 'gym' ? 'gym' : 'home')
  const [following, setFollowing] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const { data, isLoading } = useExerciseAlternatives(slot?.exerciseId ?? null, direction, location)
  const patch = usePatchProgramExercise()

  const choose = (alt: ExerciseListItem) => {
    if (!slot) return
    patch.mutate(
      { id: slot.id, input: { exerciseId: alt.id, applyToFollowingWeeks: following } },
      {
        onSuccess: (r) => {
          showToast(r.swapped > 1 ? `Zamienione: ${alt.name} (${r.swapped}× w planie)` : `Zamienione: ${alt.name}`)
          onClose()
        },
        onError: (e) => showToast(errorText(e, 'Nie udało się zamienić ćwiczenia.')),
      },
    )
  }

  return (
    <>
      <Sheet open={!!slot} onClose={onClose} title="Zamień ćwiczenie" width={560}>
        {slot && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ margin: 0, font: sans(14), color: 'var(--text-2)' }}>
              Zamiast <b style={{ color: 'var(--text)' }}>{slot.name}</b> — ćwiczenia na te same partie
              ({slot.primaryMuscles.map((m) => muscleLabel[m].toLowerCase()).join(', ')}).
            </p>
            <Segmented
              value={direction}
              onChange={setDirection}
              items={[
                { key: 'easier', label: 'Łatwiejsze' },
                { key: 'similar', label: 'Podobne' },
                { key: 'harder', label: 'Trudniejsze' },
              ]}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Chip active={location === 'home'} onClick={() => setLocation('home')}>Mój sprzęt w domu</Chip>
              <Chip active={location === 'none'} onClick={() => setLocation('none')}>Bez sprzętu</Chip>
              <Chip active={location === 'gym'} onClick={() => setLocation('gym')}>Siłownia</Chip>
            </div>
            <Toggle on={following} onChange={setFollowing} label="Też w kolejnych tygodniach" />

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {isLoading && <p style={{ font: sans(14), color: 'var(--text-3)' }}>Szukam…</p>}
              {data && data.items.length === 0 && (
                <p style={{ font: sans(14), color: 'var(--text-2)' }}>Brak zamienników z tym sprzętem — spróbuj innego filtra.</p>
              )}
              {data?.items.map((alt) => (
                <div key={alt.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    disabled={patch.isPending}
                    onClick={() => choose(alt)}
                    style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, border: 0, padding: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
                  >
                    <span style={{ width: 60, height: 40, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      {alt.thumbnailUrl && <img src={alt.thumbnailUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ font: sans(15, 600) }}>
                        {alt.name}
                        {alt.hasVideo && <span style={{ font: mono(10, 600), color: 'var(--accent-text)', marginLeft: 6 }}>▶</span>}
                      </span>
                      <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>
                        {equipmentLabel[alt.equipment]} · {exerciseLevelLabel[alt.level]}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreview(alt.id)}
                    aria-label={`Pokaż: ${alt.name}`}
                    style={{ border: '1px solid var(--border)', borderRadius: 999, width: 32, height: 32, background: 'transparent', cursor: 'pointer', font: mono(13, 600), color: 'var(--text-2)', flexShrink: 0 }}
                  >
                    i
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Sheet>
      <ExerciseSheet id={preview} onClose={() => setPreview(null)} />
    </>
  )
}
