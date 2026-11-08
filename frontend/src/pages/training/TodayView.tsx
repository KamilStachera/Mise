import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../api/hooks'
import { useTrainingToday, type ProgramDay } from '../../api/training'
import { DayCard, dayDateLabel } from '../../components/training/DayCard'
import { ExerciseSheet } from '../../components/training/ExerciseSheet'
import { PlanCta } from '../../components/training/PlanCta'
import { TrainingNav } from '../../components/training/TrainingNav'
import { Button, PageTitle, sans, usePagePad } from '../../components/ui'
import { DAY_NAMES_PL } from '../../lib/labels'
import { dayShortMonth, parseISODate, todayIso } from '../../lib/dates'
import { useIsMobile } from '../../lib/useIsMobile'

/**
 * Dziś: today's workout from the active plan, or a rest day with the next one previewed.
 * Read-only for now — set-by-set logging arrives with the live tracker (P4).
 */
export function TodayView() {
  const pad = usePagePad()
  const isMobile = useIsMobile()
  const nav = useNavigate()
  const { canEdit, isLoading: authLoading } = useAuth()
  const { data, isLoading } = useTrainingToday()
  const [exercise, setExercise] = useState<string | null>(null)
  const today = parseISODate(todayIso())

  const title = `${DAY_NAMES_PL[(today.getDay() + 6) % 7]}, ${dayShortMonth(today)}`

  if (!authLoading && !canEdit) {
    return (
      <div style={{ ...pad, maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <PageTitle title="Trening" sub="Plan i postępy są prywatne — zaloguj się, żeby je zobaczyć." />
        <Button variant="quiet" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/trening/cwiczenia')}>Zobacz katalog ćwiczeń</Button>
      </div>
    )
  }

  const preview = (day: ProgramDay, label: string) => (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
      <DayCard day={day} compact eyebrow={`${label} · ${dayDateLabel(day)} · tydzień ${day.week}`} onOpenExercise={setExercise} />
    </section>
  )

  return (
    <div style={{ ...pad, maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 26 }}>
      <TrainingNav />
      <PageTitle
        title={title}
        sub={data?.program ? `${data.program.name}${data.week ? ` · tydzień ${data.week} z ${data.program.weeks}` : ''}` : undefined}
      />

      {isLoading && <p style={{ font: sans(14), color: 'var(--text-3)' }}>Ładuję…</p>}

      {data?.status === 'none' && <PlanCta />}
      {data?.status === 'finished' && <PlanCta finished />}

      {data?.status === 'scheduled' && data.day && (
        <DayCard day={data.day} eyebrow="DZIŚ" onOpenExercise={setExercise} />
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

      {data?.program && (
        <Button variant="text" style={{ alignSelf: 'flex-start', color: 'var(--accent-text)' }} onClick={() => nav('/trening/plan')}>
          Cały plan →
        </Button>
      )}

      <ExerciseSheet id={exercise} onClose={() => setExercise(null)} />
    </div>
  )
}
