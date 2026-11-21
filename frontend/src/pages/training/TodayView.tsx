import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, errorText } from '../../api/client'
import { useAuth } from '../../api/hooks'
import { useStartSession, useTrainingToday, type ProgramDay } from '../../api/training'
import { DayCard, dayDateLabel } from '../../components/training/DayCard'
import { ExerciseSheet } from '../../components/training/ExerciseSheet'
import { PlanCta } from '../../components/training/PlanCta'
import { TrainingNav } from '../../components/training/TrainingNav'
import { Button, Eyebrow, PageTitle, mono, sans, usePagePad } from '../../components/ui'
import { DAY_NAMES_PL } from '../../lib/labels'
import { dayShortMonth, parseISODate, todayIso } from '../../lib/dates'
import { showToast } from '../../lib/toastBus'
import { formatVolume, pluralSets } from '../../lib/trainingStats'
import { useIsMobile } from '../../lib/useIsMobile'

/**
 * Dziś: today's workout from the active plan, active live session resume banner, one-tap
 * follow-along completion, and quick ad-hoc workout launch.
 */
export function TodayView() {
  const pad = usePagePad()
  const isMobile = useIsMobile()
  const nav = useNavigate()
  const { canEdit, isLoading: authLoading } = useAuth()
  const todayStr = todayIso()
  const { data, isLoading } = useTrainingToday(todayStr)
  const startSession = useStartSession()
  const [exercise, setExercise] = useState<string | null>(null)
  const today = parseISODate(todayStr)

  const title = `${DAY_NAMES_PL[(today.getDay() + 6) % 7]}, ${dayShortMonth(today)}`

  if (!authLoading && !canEdit) {
    return (
      <div style={{ ...pad, maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <PageTitle title="Trening" sub="Plan i postępy są prywatne — zaloguj się, żeby je zobaczyć." />
        <Button variant="quiet" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/trening/cwiczenia')}>Zobacz katalog ćwiczeń</Button>
      </div>
    )
  }

  const handleStartDay = async (day: ProgramDay) => {
    if (data?.activeSession) {
      if (data.activeSession.programDayId === day.id) {
        nav(`/trening/sesja/${data.activeSession.id}`)
        return
      }
      showToast('Masz już aktywny trening — wznawiam go.')
      nav(`/trening/sesja/${data.activeSession.id}`)
      return
    }
    try {
      const created = await startSession.mutateAsync({ programDayId: day.id, date: todayStr })
      nav(`/trening/sesja/${created.id}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const activeId = typeof err.payload?.activeSessionId === 'string' ? err.payload.activeSessionId : null
        if (activeId) {
          showToast('Wznawiam otwarty trening.')
          nav(`/trening/sesja/${activeId}`)
          return
        }
      }
      showToast(errorText(err, 'Nie udało się rozpocząć treningu.'))
    }
  }

  const handleCompleteFollowAlong = async (day: ProgramDay) => {
    try {
      const created = await startSession.mutateAsync({
        programDayId: day.id,
        date: todayStr,
        completeNow: true,
        durationMinutes: day.video?.minutes ?? 30,
      })
      showToast(`Zapisano trening z filmem (${created.durationMinutes ?? 30} min)`)
    } catch (err) {
      showToast(errorText(err, 'Nie udało się zapisać treningu.'))
    }
  }

  const handleStartAdHoc = async () => {
    if (data?.activeSession) {
      nav(`/trening/sesja/${data.activeSession.id}`)
      return
    }
    try {
      const created = await startSession.mutateAsync({ name: 'Trening własny', date: todayStr })
      nav(`/trening/sesja/${created.id}`)
    } catch (err) {
      showToast(errorText(err, 'Nie udało się rozpocząć treningu.'))
    }
  }

  const preview = (day: ProgramDay, label: string) => (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
      <DayCard
        day={day}
        compact
        eyebrow={`${label} · ${dayDateLabel(day)} · tydzień ${day.week}`}
        onOpenExercise={setExercise}
        actions={
          day.kind === 'exercises' && !data?.activeSession ? (
            <Button variant="quiet" size="sm" onClick={() => handleStartDay(day)} disabled={startSession.isPending}>
              Rozpocznij
            </Button>
          ) : undefined
        }
      />
    </section>
  )

  const active = data?.activeSession ?? null
  const completedToday = data?.completedToday ?? []
  const todayDayDone = data?.day
    ? completedToday.find((s) => s.programDayId === data.day!.id) ?? (data.day.completedSessionId ? { id: data.day.completedSessionId } : null)
    : null

  return (
    <div style={{ ...pad, maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 26 }}>
      <TrainingNav />
      <PageTitle
        title={title}
        sub={data?.program ? `${data.program.name}${data.week ? ` · tydzień ${data.week} z ${data.program.weeks}` : ''}` : undefined}
      />

      {isLoading && <p style={{ font: sans(14), color: 'var(--text-3)' }}>Ładuję…</p>}

      {/* Active live session resume banner */}
      {active && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 16px',
            borderRadius: 12,
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Eyebrow tone="accent">Trening w toku</Eyebrow>
            <span style={{ font: sans(16, 600) }}>
              {active.name} · {active.completedSets}/{active.totalSets} serii
            </span>
          </div>
          <Button size="sm" onClick={() => nav(`/trening/sesja/${active.id}`)}>Wznów trening</Button>
        </div>
      )}

      {/* Completed today strip */}
      {completedToday.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Eyebrow tone="ink">Ukończone dziś</Eyebrow>
          {completedToday.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ font: sans(15, 600), color: 'var(--sage-text)' }}>
                  ✓ {s.name}{s.prCount > 0 ? ` · 🏆 ${s.prCount} PR` : ''}
                </span>
                <span style={{ font: mono(12, 500), color: 'var(--text-2)' }}>
                  {[
                    s.durationMinutes != null ? `${s.durationMinutes} min` : null,
                    s.kind === 'follow-along' ? 'z filmem' : pluralSets(s.completedSets),
                    s.totalVolumeKg > 0 ? formatVolume(s.totalVolumeKg) : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Button variant="quiet" size="sm" onClick={() => nav(`/trening/sesja/${s.id}`)}>Podsumowanie</Button>
            </div>
          ))}
        </div>
      )}

      {data?.status === 'none' && <PlanCta />}
      {data?.status === 'finished' && <PlanCta finished />}

      {data?.status === 'scheduled' && data.day && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <DayCard
            day={data.day}
            eyebrow={todayDayDone ? 'DZIŚ · UKOŃCZONO ✓' : 'DZIŚ'}
            onOpenExercise={setExercise}
            actions={
              !isMobile && (
                data.day.kind === 'follow-along' ? (
                  <Button
                    size="sm"
                    variant={todayDayDone ? 'quiet' : 'primary'}
                    onClick={() => handleCompleteFollowAlong(data.day!)}
                    disabled={startSession.isPending}
                  >
                    {todayDayDone ? 'Zapisz ponownie' : 'Oznacz ukończony ✓'}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={todayDayDone ? 'quiet' : 'primary'}
                    onClick={() => handleStartDay(data.day!)}
                    disabled={startSession.isPending}
                  >
                    {active?.programDayId === data.day.id ? 'Wznów trening' : todayDayDone ? 'Trenuj ponownie' : 'Rozpocznij trening'}
                  </Button>
                )
              )
            }
          />
          {isMobile && (
            data.day.kind === 'follow-along' ? (
              <Button
                size="lg"
                variant={todayDayDone ? 'quiet' : 'primary'}
                style={{ width: '100%' }}
                onClick={() => handleCompleteFollowAlong(data.day!)}
                disabled={startSession.isPending}
              >
                {todayDayDone ? 'Zapisz ponownie ✓' : 'Zakończony trening z filmem ✓'}
              </Button>
            ) : (
              <Button
                size="lg"
                variant={todayDayDone ? 'quiet' : 'primary'}
                style={{ width: '100%' }}
                onClick={() => handleStartDay(data.day!)}
                disabled={startSession.isPending}
              >
                {active?.programDayId === data.day.id ? 'Wznów trening' : todayDayDone ? 'Trenuj ponownie' : 'Rozpocznij trening'}
              </Button>
            )
          )}
        </div>
      )}

      {(data?.status === 'rest' || data?.status === 'before-start') && (
        <>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 28 }}>
              {data.status === 'rest' ? 'Dziś odpoczynek' : 'Plan jeszcze się nie zaczął'}
            </span>
            <span style={{ font: sans(14.5), color: 'var(--text-2)' }}>
              {data.status === 'rest'
                ? 'Regeneracja też jest częścią planu — spacer albo rozciąganie mile widziane.'
                : `Start: ${data.program ? dayShortMonth(parseISODate(data.program.startDate)) : ''}.`}
            </span>
          </section>
          {data.next && preview(data.next, 'NASTĘPNY TRENING')}
        </>
      )}

      {data?.status === 'scheduled' && data.next && preview(data.next, 'POTEM')}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', paddingTop: 4 }}>
        {!active && (
          <Button variant="quiet" size="sm" onClick={handleStartAdHoc} disabled={startSession.isPending}>
            + Trening własny
          </Button>
        )}
        {data?.program && (
          <Button variant="text" style={{ color: 'var(--accent-text)' }} onClick={() => nav('/trening/plan')}>
            Cały plan →
          </Button>
        )}
        <Button variant="text" style={{ color: 'var(--text-2)' }} onClick={() => nav('/trening/historia')}>
          Historia i rekordy →
        </Button>
      </div>

      <ExerciseSheet id={exercise} onClose={() => setExercise(null)} />
    </div>
  )
}
