import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { errorText } from '../../api/client'
import {
  useDeleteDay, useSaveDay,
  type DayKind, type ExerciseListItem, type ProgramDay, type ProgramDayInput, type TrainingLocation, type TrainingProgram,
} from '../../api/training'
import { trainingLocationLabel } from '../../lib/labels'
import { showToast } from '../../lib/toastBus'
import { WEEKDAY_SHORT } from '../../lib/dates'
import { Button, Chip, Segmented, Sheet, inputStyle, mono, sans } from '../ui'
import { ExercisePicker } from './ExercisePicker'

interface Row {
  key: string
  exerciseId: string
  name: string
  isTimed: boolean
  sets: string
  repsMin: string
  repsMax: string
  seconds: string
  rest: string
  kg: string
}

export interface DayEditorTarget {
  program: TrainingProgram
  /** null = a new day at (week, weekday). */
  day: ProgramDay | null
  week: number
  weekday: number
}

const num = (s: string): number | null => {
  const v = Number(s.replace(',', '.'))
  return s.trim() === '' || !Number.isFinite(v) ? null : v
}
const str = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))

/**
 * Edit (or add) one plan day: name, weekday, where, and either the exercise list
 * (sets / reps or seconds / rest / kg, reorder, remove, add from the catalog) or a follow-along
 * YouTube workout. Saves the whole day at once; server validation errors show inline.
 */
export function DayEditorSheet({ target, onClose }: { target: DayEditorTarget | null; onClose: () => void }) {
  const save = useSaveDay()
  const remove = useDeleteDay()
  const [name, setName] = useState('')
  const [weekday, setWeekday] = useState(0)
  const [kind, setKind] = useState<DayKind>('exercises')
  const [location, setLocation] = useState<TrainingLocation>('any')
  const [notes, setNotes] = useState('')
  const [video, setVideo] = useState('')
  const [minutes, setMinutes] = useState('')
  const [workoutType, setWorkoutType] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [picker, setPicker] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    const d = target.day
    setName(d?.name ?? '')
    setWeekday(d?.weekday ?? target.weekday)
    setKind(d?.kind ?? 'exercises')
    setLocation(d?.location ?? 'any')
    setNotes(d?.notes ?? '')
    setVideo(d?.video ? `https://www.youtube.com/watch?v=${d.video.youtubeId}` : '')
    setMinutes(str(d?.video?.minutes))
    setWorkoutType(d?.video?.workoutType ?? '')
    setRows((d?.exercises ?? []).map((e) => ({
      key: e.id, exerciseId: e.exerciseId, name: e.name, isTimed: e.seconds != null,
      sets: str(e.sets), repsMin: str(e.repsMin), repsMax: str(e.repsMax), seconds: str(e.seconds),
      rest: str(e.restSeconds), kg: str(e.targetKg),
    })))
    setError(null)
  }, [target])

  if (!target) return null
  const { program, day, week } = target
  const taken = new Set(program.days.filter((d) => d.week === week && d.id !== day?.id).map((d) => d.weekday))

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const move = (i: number, by: number) => setRows((rs) => {
    const next = [...rs]
    const [r] = next.splice(i, 1)
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, r)
    return next
  })
  const add = (e: ExerciseListItem) => {
    setRows((rs) => [...rs, {
      key: `new-${Date.now()}`, exerciseId: e.id, name: e.name, isTimed: e.isTimed,
      sets: '3', repsMin: e.isTimed ? '' : '10', repsMax: e.isTimed ? '' : '12', seconds: e.isTimed ? '30' : '',
      rest: e.isTimed ? '45' : '75', kg: '',
    }])
    setPicker(false)
  }

  const submit = () => {
    const input: ProgramDayInput = {
      week, weekday, name: name.trim(), kind, location, notes: notes.trim(),
      ...(kind === 'follow-along'
        ? { videoYoutubeId: video.trim(), videoMinutes: num(minutes), workoutType: workoutType.trim() || null }
        : {
            exercises: rows.map((r) => ({
              exerciseId: r.exerciseId,
              sets: num(r.sets) ?? 3,
              ...(r.isTimed
                ? { seconds: num(r.seconds) }
                : { repsMin: num(r.repsMin), repsMax: num(r.repsMax) }),
              restSeconds: num(r.rest) ?? 60,
              targetKg: num(r.kg),
            })),
          }),
    }
    setError(null)
    save.mutate(
      { programId: program.id, dayId: day?.id, day: input },
      { onSuccess: () => { showToast('Zapisano dzień.'); onClose() }, onError: (e) => setError(errorText(e)) },
    )
  }

  const del = () => {
    if (!day || !window.confirm(`Usunąć „${day.name}” z tygodnia ${week}?`)) return
    remove.mutate({ programId: program.id, dayId: day.id }, { onSuccess: onClose, onError: (e) => setError(errorText(e)) })
  }

  const small: CSSProperties = { ...inputStyle, height: 38, padding: '0 8px', font: mono(14, 500), textAlign: 'center' }

  return (
    <>
      <Sheet open onClose={onClose} title={day ? 'Edytuj trening' : `Nowy trening · tydz. ${week}`} width={640}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Nazwa">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Dół ciała A" />
          </Field>

          <Field label="Dzień">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {WEEKDAY_SHORT.map((w, i) => (
                <Chip key={w} active={weekday === i} onClick={taken.has(i) ? undefined : () => setWeekday(i)}
                  style={taken.has(i) ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
                  title={taken.has(i) ? 'Ten dzień ma już trening' : undefined}>
                  {w}
                </Chip>
              ))}
            </div>
          </Field>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="Rodzaj" style={{ flex: '1 1 220px' }}>
              <Segmented value={kind} onChange={setKind} items={[{ key: 'exercises', label: 'Ćwiczenia' }, { key: 'follow-along', label: 'Film' }]} />
            </Field>
            <Field label="Gdzie" style={{ flex: '1 1 220px' }}>
              <Segmented
                value={location}
                onChange={setLocation}
                items={(['home', 'gym', 'any'] as TrainingLocation[]).map((l) => ({ key: l, label: l === 'any' ? 'Obojętnie' : trainingLocationLabel[l] }))}
              />
            </Field>
          </div>

          {kind === 'follow-along' ? (
            <>
              <Field label="Film z YouTube (link)">
                <input style={inputStyle} value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
              </Field>
              <div style={{ display: 'flex', gap: 12 }}>
                <Field label="Minuty" style={{ width: 110 }}>
                  <input style={inputStyle} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                </Field>
                <Field label="Rodzaj aktywności" style={{ flex: 1 }}>
                  <input style={inputStyle} value={workoutType} onChange={(e) => setWorkoutType(e.target.value)} placeholder="Pilates, Joga, HIIT…" />
                </Field>
              </div>
            </>
          ) : (
            <Field label="Ćwiczenia">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {rows.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) repeat(4, 54px)', gap: 6, font: mono(10, 500), color: 'var(--text-3)', letterSpacing: '.06em', padding: '0 0 4px' }}>
                    <span />
                    <span style={{ textAlign: 'center' }}>SERIE</span>
                    <span style={{ textAlign: 'center' }}>POWT. / S</span>
                    <span style={{ textAlign: 'center' }}>PRZERWA</span>
                    <span style={{ textAlign: 'center' }}>KG</span>
                  </div>
                )}
                {rows.map((r, i) => (
                  <div key={r.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) repeat(4, 54px)', gap: 6, alignItems: 'center' }}>
                      <span style={{ font: sans(14, 600), overflow: 'hidden', textOverflow: 'ellipsis' }}>{i + 1}. {r.name}</span>
                      <input aria-label="Serie" style={small} inputMode="numeric" value={r.sets} onChange={(e) => update(r.key, { sets: e.target.value })} />
                      {r.isTimed ? (
                        <input aria-label="Sekundy" style={small} inputMode="numeric" value={r.seconds} onChange={(e) => update(r.key, { seconds: e.target.value })} placeholder="s" />
                      ) : (
                        <input
                          aria-label="Powtórzenia"
                          style={small}
                          value={r.repsMin === r.repsMax || !r.repsMax ? r.repsMin : `${r.repsMin}-${r.repsMax}`}
                          onChange={(e) => {
                            const [lo, hi] = e.target.value.split(/[-–]/)
                            update(r.key, { repsMin: lo ?? '', repsMax: hi ?? lo ?? '' })
                          }}
                          placeholder="10-12"
                        />
                      )}
                      <input aria-label="Przerwa (s)" style={small} inputMode="numeric" value={r.rest} onChange={(e) => update(r.key, { rest: e.target.value })} />
                      <input aria-label="Ciężar (kg)" style={small} inputMode="decimal" value={r.kg} onChange={(e) => update(r.key, { kg: e.target.value })} placeholder="–" />
                    </div>
                    <div style={{ display: 'flex', gap: 14 }}>
                      <RowAction disabled={i === 0} onClick={() => move(i, -1)}>↑ wyżej</RowAction>
                      <RowAction disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓ niżej</RowAction>
                      <RowAction onClick={() => update(r.key, r.isTimed
                        ? { isTimed: false, repsMin: '10', repsMax: '12', seconds: '' }
                        : { isTimed: true, seconds: '30', repsMin: '', repsMax: '' })}>
                        {r.isTimed ? 'na powtórzenia' : 'na czas'}
                      </RowAction>
                      <RowAction danger onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>usuń</RowAction>
                    </div>
                  </div>
                ))}
                <Button variant="quiet" size="sm" style={{ alignSelf: 'flex-start', marginTop: 10 }} onClick={() => setPicker(true)}>
                  + Dodaj ćwiczenie
                </Button>
              </div>
            </Field>
          )}

          <Field label="Notatka (rozgrzewka, wskazówki)">
            <textarea
              style={{ ...inputStyle, height: 'auto', minHeight: 64, padding: '10px 14px', resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          {error && <p role="alert" style={{ margin: 0, font: sans(13.5, 500), color: 'var(--accent-text)' }}>{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            {day ? <Button variant="text" onClick={del} disabled={remove.isPending} style={{ color: 'var(--accent-text)' }}>Usuń dzień</Button> : <span />}
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="quiet" onClick={onClose}>Anuluj</Button>
              <Button onClick={submit} disabled={save.isPending || !name.trim()}>Zapisz</Button>
            </div>
          </div>
        </div>
      </Sheet>
      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={add} homeFirst={location === 'home'} />
    </>
  )
}

function Field({ label, children, style }: { label: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <span style={{ font: mono(10.5, 500), letterSpacing: '.08em', color: 'var(--text-3)', textTransform: 'uppercase' }}>{label}</span>
      {children}
    </div>
  )
}

function RowAction({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ border: 0, padding: 0, background: 'transparent', cursor: disabled ? 'default' : 'pointer', font: sans(12.5, 500), color: danger ? 'var(--accent-text)' : 'var(--text-3)', opacity: disabled ? 0.35 : 1 }}
    >
      {children}
    </button>
  )
}
