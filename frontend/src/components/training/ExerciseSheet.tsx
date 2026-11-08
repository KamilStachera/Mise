import { useEffect, useState, type ReactNode } from 'react'
import { useExercise } from '../../api/training'
import { equipmentLabel, exerciseCategoryLabel, exerciseLevelLabel } from '../../lib/labels'
import { Eyebrow, Sheet, mono, sans } from '../ui'
import { BodyMap } from './BodyMap'
import { YouTubeEmbed, youtubeSearchUrl } from './YouTubeEmbed'

/**
 * One exercise: demo video (or a YouTube search until one is picked), the muscle map,
 * how to do it, "Na co uważać" and "Częste błędy". Opened from the catalog (and later from
 * the plan and the live workout).
 */
export function ExerciseSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: ex, isLoading, isError } = useExercise(id)

  return (
    <Sheet open={!!id} onClose={onClose} title={ex?.name ?? (isLoading ? 'Ładuję…' : 'Ćwiczenie')} width={600}>
      {isError && <p style={{ font: sans(14), color: 'var(--text-2)' }}>Nie udało się wczytać ćwiczenia.</p>}
      {ex && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: -6 }}>
            {ex.namePl && <span style={{ font: sans(13), color: 'var(--text-3)' }}>{ex.nameEn}</span>}
            <Eyebrow>
              {[exerciseLevelLabel[ex.level], equipmentLabel[ex.equipment], exerciseCategoryLabel[ex.category], ex.isTimed ? 'na czas' : null]
                .filter(Boolean).join(' · ')}
            </Eyebrow>
          </div>

          {ex.youtubeId ? (
            <YouTubeEmbed id={ex.youtubeId} start={ex.videoStartSeconds} title={ex.videoTitle} channel={ex.videoChannel} />
          ) : (
            <a
              href={youtubeSearchUrl(ex.namePl, ex.nameEn)}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '12px 14px', borderRadius: 12, border: '1px dashed var(--border-2)',
                font: sans(14, 600), color: 'var(--text)', textDecoration: 'none',
              }}
            >
              <span>Szukaj filmu instruktażowego na YouTube</span>
              <span style={{ font: mono(12, 500), color: 'var(--accent-text)' }}>↗</span>
            </a>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', justifyContent: 'center' }}>
            {ex.imageUrls.length > 0 && <StepPhotos urls={ex.imageUrls} alt={ex.name} />}
            <BodyMap primary={ex.primaryMuscles} secondary={ex.secondaryMuscles} height={200} />
          </div>

          <Section title="Jak wykonać">
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ex.instructions.map((s, i) => <li key={i} style={{ font: sans(14.5), lineHeight: 1.5 }}>{s}</li>)}
            </ol>
            {!ex.instructionsArePolish && ex.instructions.length > 0 && (
              <p style={{ margin: '10px 0 0', font: sans(12.5), color: 'var(--text-3)' }}>
                Opis po angielsku — polski dopisze agent („/wzbogac-cwiczenia”).
              </p>
            )}
          </Section>

          {ex.tipsPl.length > 0 && (
            <Section title="Na co uważać" tone="var(--sage-text)">
              <Bullets items={ex.tipsPl} mark="✓" color="var(--sage-text)" />
            </Section>
          )}
          {ex.mistakesPl.length > 0 && (
            <Section title="Częste błędy" tone="var(--accent-text)">
              <Bullets items={ex.mistakesPl} mark="✕" color="var(--accent-text)" />
            </Section>
          )}
        </div>
      )}
    </Sheet>
  )
}

/** The two upstream photos are the start and end position — alternate them like a slow GIF. */
function StepPhotos({ urls, alt }: { urls: string[]; alt: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (urls.length < 2) return
    const t = window.setInterval(() => setI((v) => (v + 1) % urls.length), 1100)
    return () => window.clearInterval(t)
  }, [urls.length])
  return (
    <div style={{ position: 'relative', width: 240, maxWidth: '100%', aspectRatio: '3 / 2', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {urls.map((u, n) => (
        <img
          key={u}
          src={u}
          alt={n === 0 ? alt : ''}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: n === i ? 1 : 0, transition: 'opacity .35s' }}
        />
      ))}
      {urls.length > 1 && (
        <span style={{ position: 'absolute', left: 8, bottom: 6, font: mono(10, 600), color: 'var(--text-2)', background: 'rgba(245,240,230,.85)', padding: '2px 6px', borderRadius: 6 }}>
          {i === 0 ? 'START' : 'KONIEC'}
        </span>
      )}
    </div>
  )
}

function Section({ title, tone, children }: { title: string; tone?: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ margin: 0, paddingBottom: 6, borderBottom: '1px solid var(--rule)', fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 20, color: tone ?? 'var(--text)' }}>
        {title}
      </h3>
      {children}
    </section>
  )
}

function Bullets({ items, mark, color }: { items: string[]; mark: string; color: string }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((s, i) => (
        <li key={i} style={{ display: 'flex', gap: 10, font: sans(14.5), lineHeight: 1.5 }}>
          <span aria-hidden style={{ font: mono(12, 700), color, paddingTop: 2 }}>{mark}</span>
          <span>{s}</span>
        </li>
      ))}
    </ul>
  )
}
