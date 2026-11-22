import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { errorText } from '../../api/client'
import { useAuth } from '../../api/hooks'
import {
  useAddSessionSet,
  useDeleteSession,
  useDeleteSessionSet,
  useExercises,
  usePatchSessionSet,
  useTrainingSession,
  type SessionExerciseGroup,
  type SessionSet,
} from '../../api/training'
import { ExerciseSheet } from '../../components/training/ExerciseSheet'
import { FinishSessionSheet } from '../../components/training/FinishSessionSheet'
import { RestTimerBar, type RestTimerState } from '../../components/training/RestTimerBar'
import { Button, Eyebrow, Sheet, mono, sans, usePagePad } from '../../components/ui'
import { dayShortMonth, parseISODate } from '../../lib/dates'
import { showToast } from '../../lib/toastBus'
import {
  formatKg,
  formatTimerClock,
  formatVolume,
  liveSetPrKind,
  parseKg,
} from '../../lib/trainingStats'
import { useIsMobile } from '../../lib/useIsMobile'

function restStorageKey(sessionId: string) {
  return `mise.restTimer.${sessionId}`
}

function loadSavedRestTimer(sessionId: string): RestTimerState | null {
  try {
    const raw = sessionStorage.getItem(restStorageKey(sessionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as RestTimerState
    if (typeof parsed.endsAtMs !== 'number' || parsed.endsAtMs <= Date.now()) {
      sessionStorage.removeItem(restStorageKey(sessionId))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function saveRestTimer(sessionId: string, state: RestTimerState | null) {
  try {
    if (!state) sessionStorage.removeItem(restStorageKey(sessionId))
    else sessionStorage.setItem(restStorageKey(sessionId), JSON.stringify(state))
  } catch {
    // Ignore storage quota errors
  }
}

function formatLastPerformance(g: SessionExerciseGroup): string | null {
  const lp = g.lastPerformance
  if (!lp || lp.sets.length === 0) return null
  const dateLabel = dayShortMonth(parseISODate(lp.date))
  if (g.isTimed) {
    const times = lp.sets.map((s) => `${s.seconds ?? 0} s`).join(', ')
    return `Ostatnio (${dateLabel}): ${times}`
  }
  const allSameWeight = lp.sets.every((s) => s.weightKg === lp.sets[0].weightKg)
  if (allSameWeight && lp.sets[0].weightKg != null && lp.sets[0].weightKg > 0) {
    const reps = lp.sets.map((s) => s.reps ?? 0).join(', ')
    return `Ostatnio (${dateLabel}): ${formatKg(lp.sets[0].weightKg)} kg × ${reps}`
  }
  const parts = lp.sets.map((s) =>
    s.weightKg != null && s.weightKg > 0
      ? `${formatKg(s.weightKg)} kg × ${s.reps ?? 0}`
      : `${s.reps ?? 0} powt.`,
  )
  return `Ostatnio (${dateLabel}): ${parts.join(' · ')}`
}

function formatTargetSummary(g: SessionExerciseGroup): string {
  const first = g.sets[0]
  if (!first) return ''
  const parts: string[] = []
  if (g.isTimed && first.targetSeconds != null) {
    parts.push(`${g.sets.length} × ${first.targetSeconds} s`)
  } else if (first.targetRepsMin != null || first.targetRepsMax != null) {
    const reps = first.targetRepsMax == null || first.targetRepsMin === first.targetRepsMax
      ? `${first.targetRepsMin ?? first.targetRepsMax}`
      : `${first.targetRepsMin}–${first.targetRepsMax}`
    parts.push(`${g.sets.length} × ${reps}`)
  }
  if (first.targetKg != null) parts.push(`cel ${formatKg(first.targetKg)} kg`)
  if (g.restSeconds > 0) parts.push(`przerwa ${g.restSeconds} s`)
  return parts.join(' · ')
}

/**
 * Full-screen live workout tracker (`/trening/sesja/:id`).
 * Supports active live sessions (with auto-saving set rows, hold countdown for timed exercises,
 * wall-clock rest timer, and Finish/PR summary) as well as viewing/editing completed sessions.
 */
export function LiveWorkoutView() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const pad = usePagePad()
  const isMobile = useIsMobile()
  const { canEdit, isLoading: authLoading } = useAuth()
  const { data: session, isLoading, isError } = useTrainingSession(id)
  const addSet = useAddSessionSet()
  const delSet = useDeleteSessionSet()
  const delSession = useDeleteSession()

  const [elapsedSec, setElapsedSec] = useState(0)
  const [restTimer, setRestTimer] = useState<RestTimerState | null>(() => (id ? loadSavedRestTimer(id) : null))
  const [finishOpen, setFinishOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [exerciseInfoId, setExerciseInfoId] = useState<string | null>(null)
  const [confirmAbandon, setConfirmAbandon] = useState(false)

  const isActive = !!session && session.finishedAt == null

  useEffect(() => {
    if (!id) return
    setRestTimer(loadSavedRestTimer(id))
  }, [id])

  useEffect(() => {
    if (!session || session.finishedAt != null) return
    const startedMs = new Date(session.startedAt).getTime()
    const update = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [session])

  const startRest = useCallback((seconds: number, label: string) => {
    if (!id || seconds <= 0) return
    const next: RestTimerState = {
      endsAtMs: Date.now() + seconds * 1000,
      totalSeconds: seconds,
      label,
    }
    setRestTimer(next)
    saveRestTimer(id, next)
  }, [id])

  const adjustRest = useCallback((deltaSeconds: number) => {
    if (!id) return
    setRestTimer((prev) => {
      if (!prev) return null
      const remaining = Math.max(0, Math.ceil((prev.endsAtMs - Date.now()) / 1000)) + deltaSeconds
      if (remaining <= 0) {
        saveRestTimer(id, null)
        return null
      }
      const next: RestTimerState = {
        endsAtMs: Date.now() + remaining * 1000,
        totalSeconds: Math.max(prev.totalSeconds, remaining),
        label: prev.label,
      }
      saveRestTimer(id, next)
      return next
    })
  }, [id])

  const dismissRest = useCallback(() => {
    if (!id) return
    setRestTimer(null)
    saveRestTimer(id, null)
  }, [id])

  if (!authLoading && !canEdit) return <Navigate to="/trening" replace />
  if (!id) return <Navigate to="/trening/dzis" replace />

  const handleDeleteSession = async () => {
    try {
      await delSession.mutateAsync(id)
      saveRestTimer(id, null)
      showToast(isActive ? 'Trening porzucony' : 'Trening usunięty z historii')
      nav(isActive ? '/trening/dzis' : '/trening/historia', { replace: true })
    } catch (err) {
      showToast(errorText(err, 'Nie udało się usunąć sesji.'))
    }
  }

  return (
    <div style={{ minHeight: '100%', paddingBottom: restTimer ? 132 : 48 }}>
      {/* Sticky live workout header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: 'var(--bg)',
          borderBottom: '1px solid var(--rule)',
          padding: isMobile ? 'calc(10px + env(safe-area-inset-top)) 16px 12px' : '14px 32px',
        }}
      >
        <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button
              type="button"
              onClick={() => nav(isActive ? '/trening/dzis' : '/trening/historia')}
              aria-label="Wróć"
              style={{
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text)',
                borderRadius: 999,
                width: 36,
                height: 36,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                flexShrink: 0,
              }}
            >
              ←
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 20 : 24, lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session?.name ?? 'Trening'}
              </span>
              {session && (
                <span style={{ font: mono(12, 500), color: isActive ? 'var(--accent-text)' : 'var(--text-3)' }}>
                  {isActive
                    ? `${formatTimerClock(elapsedSec)} · ${session.completedSets}/${session.totalSets} serii${session.totalVolumeKg > 0 ? ` · ${formatVolume(session.totalVolumeKg)}` : ''}`
                    : `${dayShortMonth(parseISODate(session.date))} · ${session.durationMinutes ?? 0} min · ${session.completedSets} serii${session.totalVolumeKg > 0 ? ` · ${formatVolume(session.totalVolumeKg)}` : ''}`}
                </span>
              )}
            </div>
          </div>

          {session && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {isActive ? (
                <Button variant="quiet" size="sm" onClick={() => setFinishOpen(true)}>Zakończ…</Button>
              ) : (
                <Button variant="quiet" size="sm" onClick={() => setFinishOpen(true)}>Podsumowanie</Button>
              )}
            </div>
          )}
        </div>
      </header>

      <div style={{ ...pad, maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {isLoading && <p style={{ font: sans(14), color: 'var(--text-3)' }}>Ładuję trening…</p>}
        {isError && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, font: sans(15), color: 'var(--text-2)' }}>Nie znaleziono tej sesji treningowej.</p>
            <Button variant="quiet" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/trening/dzis')}>Wróć do Dziś</Button>
          </div>
        )}

        {session && session.exercises.length === 0 && session.kind === 'exercises' && (
          <div style={{ padding: '20px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontFamily: 'var(--serif)', fontSize: 22 }}>Pusty trening</span>
            <p style={{ margin: 0, font: sans(14.5), color: 'var(--text-2)' }}>
              Dodaj pierwsze ćwiczenie z katalogu poniżej, żeby logować serie i ciężary.
            </p>
          </div>
        )}

        {session && session.kind === 'follow-along' && session.exercises.length === 0 && (
          <div style={{ padding: '16px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Eyebrow tone="accent">Trening z filmem</Eyebrow>
            <p style={{ margin: 0, font: sans(14.5), color: 'var(--text-2)' }}>
              Czas: {session.durationMinutes ?? 0} min{session.estimatedKcal != null ? ` · ~${session.estimatedKcal} kcal` : ''}.
              {session.notes ? ` ${session.notes}` : ''}
            </p>
          </div>
        )}

        {session?.exercises.map((group) => (
          <ExerciseCard
            key={`${group.order}-${group.exerciseId}`}
            sessionId={session.id}
            group={group}
            isActive={isActive}
            onOpenInfo={() => setExerciseInfoId(group.exerciseId)}
            onStartRest={(sec) => startRest(sec, group.name)}
            onAddSet={() => addSet.mutate({ sessionId: session.id, input: { exerciseId: group.exerciseId, exerciseOrder: group.order } })}
            onDeleteSet={(setId) => delSet.mutate({ sessionId: session.id, setId })}
            addingSet={addSet.isPending}
            deletingSet={delSet.isPending}
          />
        ))}

        {session && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--rule)' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>+ Dodaj ćwiczenie</Button>
              {isActive && (
                <Button size="sm" onClick={() => setFinishOpen(true)}>Zakończ i zapisz</Button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setConfirmAbandon(true)}
              style={{ border: 0, background: 'transparent', padding: '6px 0', cursor: 'pointer', font: sans(13.5, 500), color: 'var(--text-3)' }}
            >
              {isActive ? 'Porzuć trening' : 'Usuń z historii'}
            </button>
          </div>
        )}
      </div>

      <RestTimerBar timer={restTimer} onAdjust={adjustRest} onDismiss={dismissRest} />

      {session && (
        <FinishSessionSheet
          open={finishOpen}
          session={session}
          onClose={() => setFinishOpen(false)}
          onCompleted={() => {
            setFinishOpen(false)
            dismissRest()
            nav('/trening/historia', { replace: true })
          }}
        />
      )}

      <AddExerciseSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={async (exerciseId) => {
          if (!session) return
          try {
            await addSet.mutateAsync({ sessionId: session.id, input: { exerciseId } })
            setPickerOpen(false)
          } catch (err) {
            showToast(errorText(err, 'Nie udało się dodać ćwiczenia.'))
          }
        }}
      />

      <Sheet open={confirmAbandon} onClose={() => setConfirmAbandon(false)} title={isActive ? 'Porzucić trening?' : 'Usunąć trening?'} width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, font: sans(14.5), color: 'var(--text-2)', lineHeight: 1.5 }}>
            {isActive
              ? 'Usunie rozpoczętą sesję i wszystkie wpisane w niej serie. Tej operacji nie da się cofnąć.'
              : 'Usunie ten trening z historii, przeliczy rekordy i usunie powiązany wpis z aktywności.'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="quiet" onClick={() => setConfirmAbandon(false)}>Anuluj</Button>
            <Button onClick={handleDeleteSession} disabled={delSession.isPending}>
              {delSession.isPending ? 'Usuwam…' : isActive ? 'Porzuć' : 'Usuń'}
            </Button>
          </div>
        </div>
      </Sheet>

      <ExerciseSheet id={exerciseInfoId} onClose={() => setExerciseInfoId(null)} />
    </div>
  )
}

function ExerciseCard({ sessionId, group, isActive, onOpenInfo, onStartRest, onAddSet, onDeleteSet, addingSet, deletingSet }: {
  sessionId: string
  group: SessionExerciseGroup
  isActive: boolean
  onOpenInfo: () => void
  onStartRest: (seconds: number) => void
  onAddSet: () => void
  onDeleteSet: (setId: string) => void
  addingSet: boolean
  deletingSet: boolean
}) {
  const isMobile = useIsMobile()
  const target = formatTargetSummary(group)
  const lastPerf = formatLastPerformance(group)
  // During a session a finished exercise folds to one line, so the current set is at the top.
  const allDone = group.sets.length > 0 && group.sets.every((s) => s.completed)
  const [open, setOpen] = useState(!(isActive && allDone))
  const [wasDone, setWasDone] = useState(allDone)
  if (wasDone !== allDone) {
    setWasDone(allDone)
    if (isActive) setOpen(!allDone)
  }
  const cols = group.isTimed ? '28px 1fr auto 44px' : isMobile ? '22px minmax(0,1fr) minmax(0,1fr) 44px' : '28px 1fr 1fr 44px'
  const lastSet = group.sets[group.sets.length - 1]

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '12px 0 0', border: 0, borderTop: '1px solid var(--rule)', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
      >
        <span style={{ color: 'var(--sage-text)', font: sans(15, 700) }}>✓</span>
        <span style={{ flex: 1, minWidth: 0, font: sans(16, 600), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</span>
        <span style={{ font: mono(12, 500), color: 'var(--text-2)' }}>{group.sets.length}/{group.sets.length} serii</span>
        <span aria-hidden style={{ color: 'var(--text-3)' }}>▾</span>
      </button>
    )
  }

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        paddingTop: 14,
        borderTop: '1px solid var(--rule)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={onOpenInfo}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, border: 0, padding: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
        >
          <span style={{ width: 52, height: 36, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            {group.thumbnailUrl && <img src={group.thumbnailUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {group.supersetGroup && (
                <span style={{ font: mono(10.5, 600), padding: '1px 6px', borderRadius: 4, background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                  Superseria {group.supersetGroup}
                </span>
              )}
              <span style={{ font: sans(16, 600), lineHeight: 1.2 }}>{group.name}</span>
              {group.hasVideo && <span style={{ font: mono(10.5, 600), color: 'var(--accent-text)' }}>▶</span>}
            </span>
            {target && <span style={{ font: mono(11.5, 500), color: 'var(--text-3)' }}>{target}</span>}
          </span>
        </button>
      </div>

      {lastPerf && (
        <span style={{ font: mono(11.5, 500), color: 'var(--text-2)', padding: '5px 10px', borderRadius: 8, background: 'var(--surface)', alignSelf: 'flex-start' }}>
          {lastPerf}
        </span>
      )}

      {/* Column headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: cols,
          gap: 8,
          alignItems: 'center',
          paddingBottom: 4,
          borderBottom: '1px solid var(--border)',
          font: mono(10.5, 600),
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--text-3)',
        }}
      >
        <span>#</span>
        {group.isTimed ? (
          <>
            <span>Czas (s)</span>
            <span>Stoper</span>
          </>
        ) : (
          <>
            <span>Ciężar (kg)</span>
            <span>Powt.</span>
          </>
        )}
        <span style={{ textAlign: 'center' }}>OK</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {group.sets.map((s) => (
          <SetRow
            key={s.id}
            sessionId={sessionId}
            set={s}
            group={group}
            isActive={isActive}
            cols={cols}
            onCompleted={() => { if (isActive && group.restSeconds > 0) onStartRest(group.restSeconds) }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 2 }}>
        {/* Deleting lives here, away from the ✓ it used to sit next to. */}
        <span style={{ display: 'flex', gap: 18 }}>
          <button
            type="button"
            onClick={onAddSet}
            disabled={addingSet}
            style={{ border: 0, background: 'transparent', padding: '8px 0', cursor: 'pointer', font: sans(13.5, 600), color: 'var(--accent-text)' }}
          >
            + Dodaj serię
          </button>
          {lastSet && (
            <button
              type="button"
              onClick={() => onDeleteSet(lastSet.id)}
              disabled={deletingSet}
              title={`Usuń serię ${lastSet.setNumber}`}
              style={{ border: 0, background: 'transparent', padding: '8px 0', cursor: 'pointer', font: sans(13.5, 500), color: 'var(--text-3)' }}
            >
              − Usuń ostatnią
            </button>
          )}
        </span>
        {isActive && group.restSeconds > 0 && (
          <button
            type="button"
            onClick={() => onStartRest(group.restSeconds)}
            style={{ border: '1px solid var(--border)', background: 'transparent', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', font: mono(11.5, 500), color: 'var(--text-2)' }}
          >
            Przerwa {group.restSeconds} s
          </button>
        )}
      </div>
    </section>
  )
}

function SetRow({ sessionId, set, group, isActive, cols, onCompleted }: {
  sessionId: string
  set: SessionSet
  group: SessionExerciseGroup
  isActive: boolean
  cols: string
  onCompleted: () => void
}) {
  const patchSet = usePatchSessionSet()
  const [weightStr, setWeightStr] = useState(() => formatKg(set.weightKg))
  const [repsStr, setRepsStr] = useState(() => (set.reps != null ? String(set.reps) : ''))
  const [secStr, setSecStr] = useState(() => (set.seconds != null ? String(set.seconds) : ''))
  const [holdEndsAt, setHoldEndsAt] = useState<number | null>(null)
  const [holdRemaining, setHoldRemaining] = useState(0)
  const holdTriggeredRef = useRef(false)

  // Sync local inputs when set changes externally
  useEffect(() => { setWeightStr(formatKg(set.weightKg)) }, [set.weightKg])
  useEffect(() => { setRepsStr(set.reps != null ? String(set.reps) : '') }, [set.reps])
  useEffect(() => { setSecStr(set.seconds != null ? String(set.seconds) : '') }, [set.seconds])

  const parsedWeight = parseKg(weightStr)
  const parsedReps = repsStr.trim() === '' ? null : Number.parseInt(repsStr.trim(), 10)
  const parsedSec = secStr.trim() === '' ? null : Number.parseInt(secStr.trim(), 10)

  const commit = useCallback((overrides?: { completed?: boolean; weightKg?: number | null; reps?: number | null; seconds?: number | null }) => {
    const w = overrides && 'weightKg' in overrides ? overrides.weightKg : parsedWeight
    const r = overrides && 'reps' in overrides ? overrides.reps : (Number.isFinite(parsedReps) ? parsedReps : null)
    const sec = overrides && 'seconds' in overrides ? overrides.seconds : (Number.isFinite(parsedSec) ? parsedSec : null)
    const nextCompleted = overrides?.completed ?? set.completed

    patchSet.mutate({
      sessionId,
      setId: set.id,
      input: {
        weightKg: w,
        clearWeight: !group.isTimed && w == null,
        reps: r,
        clearReps: !group.isTimed && r == null,
        seconds: sec,
        clearSeconds: group.isTimed && sec == null,
        completed: nextCompleted,
      },
    })
  }, [group.isTimed, parsedReps, parsedSec, parsedWeight, patchSet, sessionId, set.completed, set.id])

  // Built-in countdown stopwatch for timed exercises (plank, holds, stretches)
  useEffect(() => {
    if (holdEndsAt == null) return
    holdTriggeredRef.current = false
    const tick = () => {
      const rem = Math.max(0, Math.ceil((holdEndsAt - Date.now()) / 1000))
      setHoldRemaining(rem)
      if (rem === 0 && !holdTriggeredRef.current) {
        holdTriggeredRef.current = true
        setHoldEndsAt(null)
        try { navigator.vibrate?.([120, 60, 120]) } catch { /* ignore */ }
        if (!set.completed) {
          commit({ completed: true })
          onCompleted()
        }
      }
    }
    tick()
    const timer = window.setInterval(tick, 200)
    return () => window.clearInterval(timer)
  }, [holdEndsAt, set.completed, commit, onCompleted])

  const toggleHoldTimer = () => {
    if (holdEndsAt != null) {
      setHoldEndsAt(null)
      return
    }
    const targetSec = (Number.isFinite(parsedSec) && (parsedSec ?? 0) > 0 ? parsedSec! : set.targetSeconds) ?? 30
    setSecStr(String(targetSec))
    setHoldEndsAt(Date.now() + targetSec * 1000)
  }

  const nudgeWeight = (delta: number) => {
    const next = Math.max(0, Math.round(((parsedWeight ?? 0) + delta) * 100) / 100)
    setWeightStr(formatKg(next))
    commit({ weightKg: next })
  }

  const nudgeReps = (delta: number) => {
    const next = Math.max(0, (Number.isFinite(parsedReps) ? parsedReps ?? 0 : 0) + delta)
    setRepsStr(String(next))
    commit({ reps: next })
  }

  const toggleComplete = () => {
    const next = !set.completed
    commit({ completed: next })
    if (next) onCompleted()
  }

  const livePr = set.isPr || (
    isActive && liveSetPrKind(
      { weightKg: parsedWeight, reps: Number.isFinite(parsedReps) ? parsedReps : null, seconds: Number.isFinite(parsedSec) ? parsedSec : null, completed: set.completed },
      group.prBaseline,
      group.isTimed,
    ) != null
  )

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: cols,
        gap: 8,
        alignItems: 'center',
        padding: '6px 4px',
        borderRadius: 10,
        background: set.completed ? 'var(--sage-soft, rgba(76, 128, 92, 0.1))' : 'transparent',
        transition: 'background .15s',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span style={{ font: mono(13, 600), color: set.completed ? 'var(--sage-text)' : 'var(--text-2)' }}>
          {set.setNumber}
        </span>
        {livePr && <span title="Nowy rekord życiowy!" style={{ font: mono(9, 700), letterSpacing: '.04em', color: 'var(--gold-text)' }}>PR</span>}
      </div>

      {group.isTimed ? (
        <>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={7200}
            aria-label={`Seria ${set.setNumber} czas w sekundach`}
            value={secStr}
            onChange={(e) => setSecStr(e.target.value)}
            onBlur={() => commit()}
            placeholder={set.targetSeconds != null ? String(set.targetSeconds) : '30'}
            style={cellInput}
          />
          <button
            type="button"
            onClick={toggleHoldTimer}
            style={{
              height: 40,
              padding: '0 12px',
              borderRadius: 10,
              border: holdEndsAt != null ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: holdEndsAt != null ? 'var(--accent-soft)' : 'var(--surface)',
              color: holdEndsAt != null ? 'var(--accent-text)' : 'var(--text)',
              font: mono(12.5, 600),
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {holdEndsAt != null ? `⏹ ${holdRemaining} s` : '▶ Start'}
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <button type="button" onClick={() => nudgeWeight(-2.5)} aria-label="Odejmij 2,5 kg" style={nudgeBtn}>−</button>
            <input
              type="text"
              inputMode="decimal"
              aria-label={`Seria ${set.setNumber} ciężar w kg`}
              value={weightStr}
              onChange={(e) => setWeightStr(e.target.value)}
              onBlur={() => commit()}
              placeholder={set.targetKg != null ? formatKg(set.targetKg) : '0'}
              style={{ ...cellInput, minWidth: 0, flex: 1 }}
            />
            <button type="button" onClick={() => nudgeWeight(2.5)} aria-label="Dodaj 2,5 kg" style={nudgeBtn}>+</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <button type="button" onClick={() => nudgeReps(-1)} aria-label="Odejmij powtórzenie" style={nudgeBtn}>−</button>
            <input
              type="text"
              inputMode="numeric"
              aria-label={`Seria ${set.setNumber} powtórzenia`}
              value={repsStr}
              onChange={(e) => setRepsStr(e.target.value.replace(/\D/g, ''))}
              onBlur={() => commit()}
              placeholder={set.targetRepsMin != null ? String(set.targetRepsMin) : '10'}
              style={{ ...cellInput, minWidth: 0, flex: 1 }}
            />
            <button type="button" onClick={() => nudgeReps(1)} aria-label="Dodaj powtórzenie" style={nudgeBtn}>+</button>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={toggleComplete}
        aria-pressed={set.completed}
        aria-label={set.completed ? `Cofnij serię ${set.setNumber}` : `Oznacz serię ${set.setNumber} jako wykonaną`}
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          border: set.completed ? 0 : '1.5px solid var(--border-2, var(--border))',
          background: set.completed ? 'var(--sage)' : 'var(--bg)',
          color: set.completed ? '#fff' : 'var(--text-3)',
          font: sans(16, 700),
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background .15s, color .15s',
        }}
      >
        ✓
      </button>

    </div>
  )
}

function AddExerciseSheet({ open, onClose, onPick }: {
  open: boolean
  onClose: () => void
  onPick: (exerciseId: string) => void
}) {
  const [q, setQ] = useState('')
  const { data } = useExercises({ q }, undefined, open)
  const items = (data?.items ?? []).slice(0, 40)

  return (
    <Sheet open={open} onClose={onClose} title="Dodaj ćwiczenie" width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Szukaj ćwiczenia (np. przysiad, plank, wyciskanie)…"
          autoFocus
          style={{
            height: 44,
            padding: '0 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            font: sans(14.5),
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 400, overflowY: 'auto' }}>
          {items.map((ex) => (
            <button
              key={ex.id}
              type="button"
              onClick={() => onPick(ex.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 4px',
                border: 0,
                borderBottom: '1px solid var(--border)',
                background: 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'var(--text)',
              }}
            >
              <span style={{ width: 44, height: 30, borderRadius: 6, overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--border)', flexShrink: 0 }}>
                {ex.thumbnailUrl && <img src={ex.thumbnailUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ font: sans(14.5, 600) }}>{ex.name}</span>
                {ex.namePl && <span style={{ font: sans(12), color: 'var(--text-3)' }}>{ex.nameEn}</span>}
              </span>
              <span style={{ font: mono(12, 600), color: 'var(--accent-text)' }}>+ Dodaj</span>
            </button>
          ))}
          {items.length === 0 && (
            <p style={{ margin: '12px 0', font: sans(14), color: 'var(--text-3)' }}>Brak pasujących ćwiczeń.</p>
          )}
        </div>
      </div>
    </Sheet>
  )
}

const cellInput: React.CSSProperties = {
  height: 44,
  padding: '0 4px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  font: mono(14.5, 600),
  textAlign: 'center',
  width: '100%',
  boxSizing: 'border-box',
}

const nudgeBtn: React.CSSProperties = {
  width: 34,
  height: 44,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-2)',
  font: mono(14, 600),
  cursor: 'pointer',
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
}
