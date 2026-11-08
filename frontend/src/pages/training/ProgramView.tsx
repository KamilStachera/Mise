import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth, useChatHealth } from '../../api/hooks'
import { useTrainingProgram, type ProgramExercise, type TrainingProgram, type TrainingLocation } from '../../api/training'
import { DayCard } from '../../components/training/DayCard'
import { DayEditorSheet, type DayEditorTarget } from '../../components/training/DayEditorSheet'
import { ExerciseSheet } from '../../components/training/ExerciseSheet'
import { PlanCta, SOUS_ADJUST_PROMPT } from '../../components/training/PlanCta'
import { SwapSheet } from '../../components/training/SwapSheet'
import { TrainingNav } from '../../components/training/TrainingNav'
import { Button, Chip, PageTitle, mono, sans, usePagePad } from '../../components/ui'
import { requestChat } from '../../lib/chatBus'
import { addDays, dayShortMonth, mondayOf, parseISODate, toISO, todayIso, WEEKDAY_SHORT } from '../../lib/dates'
import { useIsMobile } from '../../lib/useIsMobile'

/** Week of the program a date falls into (1-based, may fall outside 1..weeks). */
function weekOf(p: TrainingProgram, iso: string): number {
  const start = mondayOf(parseISODate(p.startDate)).getTime()
  const day = mondayOf(parseISODate(iso)).getTime()
  return Math.round((day - start) / (7 * 86_400_000)) + 1
}

/**
 * Plan: the active program week by week. Every weekday shows its workout (tap an exercise for
 * the how-to sheet, "Zamień" to swap it) or a rest day; days are edited in a sheet.
 */
export function ProgramView() {
  const pad = usePagePad()
  const isMobile = useIsMobile()
  const nav = useNavigate()
  const { canEdit, isLoading: authLoading } = useAuth()
  const { data: chat } = useChatHealth()
  const { data: program, isLoading } = useTrainingProgram()
  const [pickedWeek, setPickedWeek] = useState<number | null>(null)
  const [exercise, setExercise] = useState<string | null>(null)
  const [swap, setSwap] = useState<{ slot: ProgramExercise; location: TrainingLocation } | null>(null)
  const [editor, setEditor] = useState<DayEditorTarget | null>(null)

  if (!authLoading && !canEdit) return <Navigate to="/trening" replace />

  const today = todayIso()
  const currentWeek = program ? Math.min(Math.max(weekOf(program, today), 1), program.weeks) : 1
  const week = pickedWeek && program && pickedWeek <= program.weeks ? pickedWeek : currentWeek
  const monday = program ? addDays(mondayOf(parseISODate(program.startDate)), (week - 1) * 7) : null

  return (
    <div style={{ ...pad, maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 26 }}>
      <TrainingNav />
      <PageTitle
        title={program?.name ?? 'Plan treningowy'}
        sub={program
          ? `${dayShortMonth(parseISODate(program.startDate))} – ${dayShortMonth(parseISODate(program.endDate))} · ${program.weeks} ${program.weeks === 1 ? 'tydzień' : program.weeks < 5 ? 'tygodnie' : 'tygodni'}${program.createdBy === 'ai' ? ' · ułożony przez AI' : ''}`
          : undefined}
        right={program && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {chat?.enabled && <Button variant="quiet" size="sm" onClick={() => requestChat(SOUS_ADJUST_PROMPT)}>✦ Dostosuj z Sous</Button>}
            <Button variant="quiet" size="sm" onClick={() => nav('/trening/ankieta')}>Ankieta</Button>
          </div>
        )}
      />

      {isLoading && <p style={{ font: sans(14), color: 'var(--text-3)' }}>Ładuję…</p>}
      {!isLoading && !program && <PlanCta />}

      {program && (
        <>
          {program.rationale && (
            <details style={{ borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
              <summary style={{ cursor: 'pointer', font: sans(14.5, 600) }}>Dlaczego taki plan</summary>
              <p style={{ margin: '10px 0 0', font: sans(14.5), lineHeight: 1.55, color: 'var(--text-2)', whiteSpace: 'pre-line' }}>{program.rationale}</p>
            </details>
          )}

          <div className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', ...(isMobile ? { margin: '0 -20px', padding: '0 20px' } : {}) }}>
            {Array.from({ length: program.weeks }, (_, i) => i + 1).map((w) => (
              <Chip key={w} active={w === week} onClick={() => setPickedWeek(w)}>
                Tydzień {w}{w === weekOf(program, today) ? ' · teraz' : ''}
              </Chip>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {week === 1 && monday && toISO(monday) < program.startDate && (
              // A plan starting mid-week: one line instead of a row per day before the start.
              <p style={{ margin: 0, padding: '12px 0', borderTop: '1px solid var(--rule)', font: sans(13.5), color: 'var(--text-3)' }}>
                Plan startuje {dayShortMonth(parseISODate(program.startDate))}.
              </p>
            )}
            {WEEKDAY_SHORT.map((label, weekday) => {
              const day = program.days.find((d) => d.week === week && d.weekday === weekday)
              const date = monday ? addDays(monday, weekday) : null
              const iso = date ? toISO(date) : ''
              const beforeStart = iso < program.startDate
              const isToday = iso === today
              if (beforeStart) return null
              return (
                <div
                  key={weekday}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '110px minmax(0, 1fr)',
                    gap: isMobile ? 8 : 20,
                    padding: '16px 0',
                    borderTop: weekday === 0 ? '1px solid var(--rule)' : '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: isMobile ? 8 : 2, alignItems: 'baseline' }}>
                    <span style={{ font: sans(15, 700), color: isToday ? 'var(--accent-text)' : 'var(--text)' }}>{label}</span>
                    <span style={{ font: mono(12, 500), color: 'var(--text-3)' }}>{date ? dayShortMonth(date) : ''}{isToday ? ' · dziś' : ''}</span>
                  </div>
                  {day ? (
                    <DayCard
                      day={day}
                      compact
                      onOpenExercise={setExercise}
                      exerciseAction={(e) => (
                        <button
                          type="button"
                          onClick={() => setSwap({ slot: e, location: day.location })}
                          style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '5px 10px', background: 'transparent', cursor: 'pointer', font: sans(12.5, 600), color: 'var(--text-2)', flexShrink: 0 }}
                        >
                          Zamień
                        </button>
                      )}
                      actions={
                        <Button variant="quiet" size="sm" onClick={() => setEditor({ program, day, week, weekday })}>Edytuj</Button>
                      }
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ font: sans(14), color: 'var(--text-3)' }}>Odpoczynek</span>
                      <button
                        type="button"
                        onClick={() => setEditor({ program, day: null, week, weekday })}
                        style={{ border: 0, background: 'transparent', cursor: 'pointer', font: sans(13, 600), color: 'var(--accent-text)' }}
                      >
                        + Dodaj trening
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <ExerciseSheet id={exercise} onClose={() => setExercise(null)} />
      <SwapSheet key={swap?.slot.id ?? 'none'} slot={swap?.slot ?? null} dayLocation={swap?.location ?? 'any'} onClose={() => setSwap(null)} />
      <DayEditorSheet target={editor} onClose={() => setEditor(null)} />
    </div>
  )
}
