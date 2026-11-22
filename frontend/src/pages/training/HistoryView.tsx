import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { errorText } from '../../api/client'
import { useAuth } from '../../api/hooks'
import {
  useDeleteSession,
  useTrainingPrs,
  useTrainingSessions,
  type ExercisePr,
  type TrainingSessionSummary,
} from '../../api/training'
import { ExerciseSheet } from '../../components/training/ExerciseSheet'
import { TrainingNav } from '../../components/training/TrainingNav'
import { SousButton } from '../../components/SousButton'
import { Button, Chip, Eyebrow, PageTitle, Segmented, StatStrip, mono, sans, usePagePad } from '../../components/ui'
import { dayShortMonth, parseISODate, WEEKDAY_SHORT } from '../../lib/dates'
import { muscleLabel } from '../../lib/labels'
import { showToast } from '../../lib/toastBus'
import { formatKg, formatVolume, pluralSets } from '../../lib/trainingStats'
import { useIsMobile } from '../../lib/useIsMobile'

type Tab = 'sessions' | 'prs'

function prHeadline(pr: ExercisePr): string {
  if (pr.isTimed && pr.bestSeconds != null) return `${pr.bestSeconds} s`
  if (pr.bestWeightKg != null) {
    return `${formatKg(pr.bestWeightKg)} kg${pr.bestWeightReps != null ? ` × ${pr.bestWeightReps}` : ''}`
  }
  if (pr.bestBodyweightReps != null) return `${pr.bestBodyweightReps} powt.`
  if (pr.bestSeconds != null) return `${pr.bestSeconds} s`
  return '—'
}

function prSubline(pr: ExercisePr): string {
  const parts: string[] = []
  if (pr.bestEst1RmKg != null) parts.push(`1RM ~${formatKg(pr.bestEst1RmKg)} kg`)
  const bestDate = pr.bestWeightDate ?? pr.bestBodyweightRepsDate ?? pr.bestSecondsDate ?? pr.lastPerformedDate
  if (bestDate) parts.push(dayShortMonth(parseISODate(bestDate)))
  parts.push(`${pr.totalSessions} ${pr.totalSessions === 1 ? 'sesja' : pr.totalSessions < 5 ? 'sesje' : 'sesji'}`)
  return parts.join(' · ')
}

/**
 * Historia (`/trening/historia`): completed workout log + Personal Records (PR) leaderboard.
 */
export function HistoryView() {
  const pad = usePagePad()
  const isMobile = useIsMobile()
  const nav = useNavigate()
  const { canEdit, isLoading: authLoading } = useAuth()
  const { data: sessions, isLoading: sessionsLoading } = useTrainingSessions(50)
  const { data: prs, isLoading: prsLoading } = useTrainingPrs()
  const delSession = useDeleteSession()

  const [tab, setTab] = useState<Tab>('sessions')
  const [search, setSearch] = useState('')
  const [muscleFilter, setMuscleFilter] = useState<string | null>(null)
  const [exerciseInfoId, setExerciseInfoId] = useState<string | null>(null)

  const activeSession = useMemo(() => (sessions ?? []).find((s) => s.finishedAt == null) ?? null, [sessions])
  const completedSessions = useMemo(() => (sessions ?? []).filter((s) => s.finishedAt != null), [sessions])

  const totalVolume = useMemo(
    () => completedSessions.reduce((acc, s) => acc + s.totalVolumeKg, 0),
    [completedSessions],
  )
  const totalCompletedSets = useMemo(
    () => completedSessions.reduce((acc, s) => acc + s.completedSets, 0),
    [completedSessions],
  )

  const muscles = useMemo(() => {
    const set = new Set<string>()
    for (const pr of prs ?? []) {
      for (const m of pr.primaryMuscles) set.add(m)
    }
    return [...set].sort((a, b) => (muscleLabel[a as keyof typeof muscleLabel] ?? a).localeCompare(muscleLabel[b as keyof typeof muscleLabel] ?? b, 'pl'))
  }, [prs])

  const filteredPrs = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (prs ?? []).filter((pr) => {
      if (muscleFilter && !pr.primaryMuscles.includes(muscleFilter as never)) return false
      if (!q) return true
      return pr.name.toLowerCase().includes(q) || pr.nameEn.toLowerCase().includes(q)
    })
  }, [prs, search, muscleFilter])

  if (!authLoading && !canEdit) return <Navigate to="/trening" replace />

  const handleDelete = async (s: TrainingSessionSummary) => {
    if (!window.confirm(`Usunąć trening „${s.name}” z historii?`)) return
    try {
      await delSession.mutateAsync(s.id)
      showToast('Trening usunięty z historii')
    } catch (err) {
      showToast(errorText(err, 'Nie udało się usunąć sesji.'))
    }
  }

  return (
    <div style={{ ...pad, maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 24 }}>
      <PageTitle
        eyebrow="Trening"
        title="Historia i rekordy"
        sub={completedSessions.length > 0 ? `${completedSessions.length} ukończonych treningów · ${(prs ?? []).length} ćwiczeń z zapisanym wynikiem` : 'Twoje zapisane sesje i rekordy życiowe.'}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <TrainingNav />
            <SousButton variant="header" />
          </div>
        }
      />

      {activeSession && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 16px',
            borderTop: '1px solid var(--accent)',
            borderBottom: '1px solid var(--accent)',
            background: 'var(--accent-soft)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Eyebrow tone="accent">Trening w toku</Eyebrow>
            <span style={{ font: sans(15.5, 600) }}>
              {activeSession.name} · {activeSession.completedSets}/{activeSession.totalSets} serii
            </span>
          </div>
          <Button size="sm" onClick={() => nav(`/trening/sesja/${activeSession.id}`)}>Wznów trening</Button>
        </div>
      )}

      <Segmented
        value={tab}
        onChange={setTab}
        style={{ width: isMobile ? '100%' : 320 }}
        items={[
          { key: 'sessions', label: `Treningi (${completedSessions.length})` },
          { key: 'prs', label: `Rekordy PR (${(prs ?? []).length})` },
        ]}
      />

      {tab === 'sessions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {completedSessions.length > 0 && (
            <StatStrip
              stacked
              items={[
                { value: String(completedSessions.length), label: 'treningów' },
                { value: String(totalCompletedSets), label: 'ukończonych serii' },
                { value: totalVolume > 0 ? formatVolume(totalVolume) : '—', label: 'łączna objętość', highlight: true },
              ]}
            />
          )}

          {sessionsLoading && <p style={{ font: sans(14), color: 'var(--text-3)' }}>Ładuję historię…</p>}

          {!sessionsLoading && completedSessions.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 0', borderTop: '1px solid var(--rule)' }}>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 24 }}>Jeszcze brak zapisanych treningów</span>
              <p style={{ margin: 0, font: sans(14.5), color: 'var(--text-2)' }}>
                Rozpocznij trening w zakładce Dziś — po zakończeniu zobaczysz tutaj historię, objętość i rekordy życiowe.
              </p>
              <Button style={{ alignSelf: 'flex-start' }} onClick={() => nav('/trening/dzis')}>Przejdź do Dziś</Button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {completedSessions.map((s, idx) => {
              const dt = parseISODate(s.date)
              const dateText = `${WEEKDAY_SHORT[(dt.getDay() + 6) % 7]}, ${dayShortMonth(dt)}`
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '14px 0',
                    borderTop: idx === 0 ? '1px solid var(--rule)' : '1px solid var(--border)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => nav(`/trening/sesja/${s.id}`)}
                    style={{ flex: 1, minWidth: 0, border: 0, padding: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: 4 }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ font: sans(16, 600) }}>{s.name}</span>
                      {s.prCount > 0 && (
                        <span style={{ font: mono(11, 600), padding: '1px 7px', borderRadius: 6, background: 'var(--gold-soft)', color: 'var(--gold-text)', border: '1px solid var(--gold)' }}>
                          ★ {s.prCount} PR
                        </span>
                      )}
                    </span>
                    <span style={{ font: mono(12, 500), color: 'var(--text-2)' }}>
                      {[
                        dateText,
                        s.durationMinutes != null ? `${s.durationMinutes} min` : null,
                        s.kind === 'follow-along' ? 'z filmem' : pluralSets(s.completedSets),
                        s.totalVolumeKg > 0 ? formatVolume(s.totalVolumeKg) : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                    {s.notes && (
                      <span style={{ font: sans(13), color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.notes}
                      </span>
                    )}
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <Button variant="quiet" size="sm" onClick={() => nav(`/trening/sesja/${s.id}`)}>Szczegóły</Button>
                    <button
                      type="button"
                      onClick={() => handleDelete(s)}
                      title="Usuń trening"
                      aria-label={`Usuń trening ${s.name}`}
                      style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-3)', padding: '6px 8px', fontSize: 15 }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'prs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {prsLoading && <p style={{ font: sans(14), color: 'var(--text-3)' }}>Ładuję rekordy…</p>}

          {!prsLoading && (prs ?? []).length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 0', borderTop: '1px solid var(--rule)' }}>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 24 }}>Twoje rekordy pojawią się po pierwszym treningu</span>
              <p style={{ margin: 0, font: sans(14.5), color: 'var(--text-2)' }}>
                Dla każdego ukończonego ćwiczenia śledzimy największy ciężar, szacowany 1RM, maks. powtórzenia i najdłuższy czas.
              </p>
            </div>
          )}

          {(prs ?? []).length > 0 && (
            <>
              <StatStrip
                stacked
                items={[
                  { value: String((prs ?? []).length), label: 'ćwiczeń z rekordem' },
                  { value: String(muscles.length), label: 'partii mięśni' },
                  { value: String(completedSessions.reduce((acc, s) => acc + s.prCount, 0)), label: 'pobitych PR łącznie' },
                ]}
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Szukaj ćwiczenia…"
                style={{
                  height: 42,
                  padding: '0 14px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  font: sans(14.5),
                  width: '100%',
                  maxWidth: 420,
                  boxSizing: 'border-box',
                }}
              />

              {muscles.length > 1 && (
                <div className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', ...(isMobile ? { margin: '0 -20px', padding: '0 20px' } : {}) }}>
                  <Chip active={muscleFilter === null} onClick={() => setMuscleFilter(null)}>Wszystkie</Chip>
                  {muscles.map((m) => (
                    <Chip key={m} active={muscleFilter === m} onClick={() => setMuscleFilter(muscleFilter === m ? null : m)}>
                      {muscleLabel[m as keyof typeof muscleLabel] ?? m}
                    </Chip>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {filteredPrs.map((pr, idx) => (
                  <button
                    key={pr.exerciseId}
                    type="button"
                    onClick={() => setExerciseInfoId(pr.exerciseId)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '12px 0',
                      border: 0,
                      borderTop: idx === 0 ? '1px solid var(--rule)' : '1px solid var(--border)',
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'var(--text)',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                      <span style={{ width: 48, height: 34, borderRadius: 6, overflow: 'hidden', background: 'var(--seg-bg)', border: '1px solid var(--border)', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        {pr.thumbnailUrl
                          ? <img src={pr.thumbnailUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          : <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 16, color: 'var(--text-2)' }}>{(pr.name.trim()[0] ?? 'Ć').toUpperCase()}</span>}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ font: sans(15, 600), lineHeight: 1.2 }}>{pr.name}</span>
                        <span style={{ font: mono(11.5, 500), color: 'var(--text-3)' }}>{prSubline(pr)}</span>
                      </span>
                    </span>
                    <span style={{ font: mono(16, 600), color: 'var(--accent-text)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {prHeadline(pr)}
                    </span>
                  </button>
                ))}
                {filteredPrs.length === 0 && (
                  <p style={{ margin: '12px 0', font: sans(14), color: 'var(--text-3)' }}>Brak wyników dla podanego filtra.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <ExerciseSheet id={exerciseInfoId} onClose={() => setExerciseInfoId(null)} />
    </div>
  )
}
