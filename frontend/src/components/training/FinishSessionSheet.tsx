import { useEffect, useState } from 'react'
import {
  useFinishSession,
  type FinishSessionResult,
  type SessionNewPr,
  type TrainingSessionDetail,
} from '../../api/training'
import { errorText } from '../../api/client'
import { formatKg, formatVolume, pluralPrs, pluralSets } from '../../lib/trainingStats'
import { showToast } from '../../lib/toastBus'
import { Button, Eyebrow, Sheet, mono, sans } from '../ui'

function formatPrLine(pr: SessionNewPr): string {
  if (pr.metric === 'seconds') {
    const prev = pr.previousValue != null ? ` (poprzednio ${Math.round(pr.previousValue)} s)` : ''
    return `${pr.seconds ?? Math.round(pr.newValue)} s${prev}`
  }
  if (pr.metric === 'reps') {
    const prev = pr.previousValue != null ? ` (poprzednio ${Math.round(pr.previousValue)} powt.)` : ''
    return `${pr.reps ?? Math.round(pr.newValue)} powt.${prev}`
  }
  if (pr.metric === 'est-1rm') {
    const prev = pr.previousValue != null ? ` (poprzednio ~${formatKg(pr.previousValue)} kg)` : ''
    return `${formatKg(pr.weightKg)} kg × ${pr.reps} · 1RM ~${formatKg(pr.newValue)} kg${prev}`
  }
  const prev = pr.previousValue != null ? ` (poprzednio ${formatKg(pr.previousValue)} kg)` : ''
  return `${formatKg(pr.weightKg)} kg × ${pr.reps}${prev}`
}

/**
 * Finish workout sheet: review duration, volume, optional kcal estimate (with watch/Strava
 * auto-dedupe reassurance), optional future-week target update, and PR celebration summary.
 */
export function FinishSessionSheet({ open, session, onClose, onCompleted }: {
  open: boolean
  session: TrainingSessionDetail
  onClose: () => void
  onCompleted: (result: FinishSessionResult) => void
}) {
  const finish = useFinishSession()
  const elapsedMin = Math.max(1, Math.min(600, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60_000)))
  const defaultDuration = session.durationMinutes ?? elapsedMin
  const defaultKcal = session.estimatedKcal ?? Math.round(defaultDuration * (session.kind === 'follow-along' ? 5.5 : 4.5))

  const [minutes, setMinutes] = useState(String(defaultDuration))
  const [kcal, setKcal] = useState(String(defaultKcal))
  const [notes, setNotes] = useState(session.notes)
  const [logActivity, setLogActivity] = useState(true)
  const [updateTargets, setUpdateTargets] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FinishSessionResult | null>(null)

  useEffect(() => {
    if (!open) return
    const dur = session.durationMinutes ?? Math.max(1, Math.min(600, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60_000)))
    const est = session.estimatedKcal ?? Math.round(dur * (session.kind === 'follow-along' ? 5.5 : 4.5))
    setMinutes(String(dur))
    setKcal(String(est))
    setNotes(session.notes)
    setLogActivity(true)
    setUpdateTargets(false)
    setError(null)
    setResult(null)
  }, [open, session])

  const submit = async () => {
    const dur = Number.parseInt(minutes.trim(), 10)
    if (!Number.isFinite(dur) || dur < 1 || dur > 600) {
      setError('Czas treningu: od 1 do 600 minut.')
      return
    }
    const kcalRaw = kcal.trim()
    let parsedKcal: number | null = null
    if (kcalRaw !== '') {
      const n = Number.parseInt(kcalRaw, 10)
      if (!Number.isFinite(n) || n < 0 || n > 5000) {
        setError('Kalorie: od 0 do 5000 kcal (albo zostaw puste).')
        return
      }
      parsedKcal = n
    }
    setError(null)
    try {
      const r = await finish.mutateAsync({
        id: session.id,
        input: {
          durationMinutes: dur,
          estimatedKcal: parsedKcal,
          clearEstimatedKcal: parsedKcal == null,
          notes,
          updateFutureTargets: updateTargets,
          logActivity,
        },
      })
      setResult(r)
      if (r.newPrs.length === 0) {
        const suffix = r.dedupedWithWatch
          ? ' · wykryto zegarek/opaskę (bez podwójnego liczenia kcal)'
          : r.updatedFutureTargets > 0
            ? ` · zaktualizowano ciężary w kolejnych tygodniach`
            : ''
        showToast(`Trening zapisany (${pluralSets(r.completedSets)})${suffix}`)
        onCompleted(r)
      }
    } catch (err) {
      setError(errorText(err, 'Nie udało się zapisać treningu.'))
    }
  }

  return (
    <Sheet
      open={open}
      onClose={result ? () => onCompleted(result) : onClose}
      title={result ? 'Trening ukończony!' : 'Zakończ trening'}
      width={500}
    >
      {result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <StatCell label="Czas" value={`${result.session.durationMinutes ?? 0} min`} />
            <StatCell label="Serie" value={String(result.completedSets)} />
            <StatCell label="Objętość" value={result.totalVolumeKg > 0 ? formatVolume(result.totalVolumeKg) : '—'} />
          </div>

          {result.newPrs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 12, background: 'var(--gold-soft)', border: '1px solid var(--gold)' }}>
              <Eyebrow tone="ink">{pluralPrs(result.newPrs.length)}</Eyebrow>
              {result.newPrs.map((pr) => (
                <div key={`${pr.exerciseId}-${pr.metric}`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ font: sans(14.5, 600) }}>{pr.exerciseName}</span>
                  <span style={{ font: mono(12.5, 500), color: 'var(--text-2)' }}>{formatPrLine(pr)}</span>
                </div>
              ))}
            </div>
          )}

          {result.updatedFutureTargets > 0 && (
            <p style={{ margin: 0, font: sans(13.5), color: 'var(--sage-text)' }}>
              ✓ Zaktualizowano docelowe ciężary w {result.updatedFutureTargets} przyszłych slotach planu.
            </p>
          )}
          {result.dedupedWithWatch && (
            <p style={{ margin: 0, font: sans(13.5), color: 'var(--text-2)' }}>
              Wykryto pokrywający się zapis z opaski lub Stravy — aktywność nie policzy kalorii podwójnie.
            </p>
          )}

          <Button size="lg" onClick={() => onCompleted(result)}>Zobacz historię</Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
            <StatCell label="Ukończone serie" value={`${session.completedSets} / ${session.totalSets}`} />
            <StatCell label="Objętość" value={session.totalVolumeKg > 0 ? formatVolume(session.totalVolumeKg) : '—'} />
            <StatCell label="Ćwiczenia" value={String(session.exercises.length)} />
          </div>

          {session.completedSets === 0 && session.kind === 'exercises' && (
            <p style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: 'var(--gold-soft)', font: sans(13.5), color: 'var(--text)' }}>
              Nie odhaczyłeś jeszcze żadnej serii — nadal możesz zapisać sesję albo wrócić i odhaczyć serie.
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={labelStyle}>
              <span>Czas (min)</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              <span>Szacowane kcal</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={5000}
                placeholder="opcjonalnie"
                value={kcal}
                onChange={(e) => setKcal(e.target.value)}
                disabled={!logActivity}
                style={{ ...inputStyle, opacity: logActivity ? 1 : 0.45 }}
              />
            </label>
          </div>

          <label style={labelStyle}>
            <span>Notatka po treningu</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Jak poszło, rezerwa w seriach, odczucia…"
              style={{ ...inputStyle, height: 'auto', padding: '10px 12px', fontFamily: 'var(--sans)', resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', font: sans(14) }}>
              <input
                type="checkbox"
                checked={logActivity}
                onChange={(e) => setLogActivity(e.target.checked)}
                style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--accent)' }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>Dodaj do dziennika aktywności</span>
                <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>
                  Jeśli nosisz zegarek (Strava) lub opaskę (Health Connect), Pichci automatycznie uniknie podwójnego liczenia kalorii.
                </span>
              </span>
            </label>

            {session.hasFutureProgramWeeks && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', font: sans(14) }}>
                <input
                  type="checkbox"
                  checked={updateTargets}
                  onChange={(e) => setUpdateTargets(e.target.checked)}
                  style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--accent)' }}
                />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Zaktualizuj docelowe ciężary w kolejnych tygodniach planu</span>
                  <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>
                    Przeniesie dzisiejsze ciężary na ten sam trening w kolejnych tygodniach.
                  </span>
                </span>
              </label>
            )}
          </div>

          {error && <p style={{ margin: 0, font: sans(13.5), color: 'var(--accent-text)' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="quiet" onClick={onClose} disabled={finish.isPending}>Wróć</Button>
            <Button onClick={submit} disabled={finish.isPending}>
              {finish.isPending ? 'Zapisuję…' : 'Zapisz trening'}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ font: mono(18, 600) }}>{value}</span>
      <span style={{ font: sans(12), color: 'var(--text-3)' }}>{label}</span>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  font: sans(13, 600),
  color: 'var(--text-2)',
}

const inputStyle: React.CSSProperties = {
  height: 42,
  padding: '0 12px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  font: mono(14, 500),
  width: '100%',
  boxSizing: 'border-box',
}
