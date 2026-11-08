import type { ReactNode } from 'react'
import { targetLine, type ProgramDay, type ProgramExercise } from '../../api/training'
import { trainingLocationLabel } from '../../lib/labels'
import { dayShortMonth, parseISODate, WEEKDAY_SHORT } from '../../lib/dates'
import { Eyebrow, mono, sans } from '../ui'
import { YouTubeEmbed } from './YouTubeEmbed'

/** "Pon 9 lis" for a program day. */
export function dayDateLabel(day: Pick<ProgramDay, 'date' | 'weekday'>): string {
  return `${WEEKDAY_SHORT[day.weekday]} ${dayShortMonth(parseISODate(day.date))}`
}

/**
 * One training day: name, where, then either the exercise list (tap = exercise sheet) or the
 * follow-along video. `exerciseAction` renders per-row controls (Zamień), `actions` the header ones.
 */
export function DayCard({ day, eyebrow, onOpenExercise, exerciseAction, actions, compact }: {
  day: ProgramDay
  eyebrow?: ReactNode
  onOpenExercise: (exerciseId: string) => void
  exerciseAction?: (e: ProgramExercise) => ReactNode
  actions?: ReactNode
  compact?: boolean
}) {
  return (
    <article style={{ display: 'flex', flexDirection: 'column', gap: compact ? 6 : 10 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: compact ? 21 : 28, lineHeight: 1.1 }}>{day.name}</span>
          <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>
            {day.kind === 'follow-along'
              ? ['Trening z filmem', day.video?.minutes ? `${day.video.minutes} min` : null, day.video?.workoutType].filter(Boolean).join(' · ')
              : `${day.exercises.length} ${plural(day.exercises.length)}`}
            {day.location !== 'any' && ` · ${trainingLocationLabel[day.location].toLowerCase()}`}
          </span>
        </div>
        {actions && <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{actions}</div>}
      </header>

      {day.notes && <p style={{ margin: 0, font: sans(13.5), color: 'var(--text-2)', lineHeight: 1.45 }}>{day.notes}</p>}

      {day.kind === 'follow-along' && day.video ? (
        <YouTubeEmbed id={day.video.youtubeId} title={day.video.title} />
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
          {day.exercises.map((e, i) => (
            <ExerciseLine key={e.id} index={i + 1} e={e} onOpen={() => onOpenExercise(e.exerciseId)} action={exerciseAction?.(e)} compact={compact} />
          ))}
        </ol>
      )}
    </article>
  )
}

function ExerciseLine({ index, e, onOpen, action, compact }: {
  index: number
  e: ProgramExercise
  onOpen: () => void
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 12, padding: compact ? '8px 0' : '10px 0', borderBottom: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={onOpen}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, border: 0, padding: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
      >
        <span style={{ font: mono(11, 600), color: 'var(--text-3)', width: 16, flexShrink: 0 }}>
          {e.supersetGroup ? `${e.supersetGroup}` : index}
        </span>
        <span style={{ width: compact ? 48 : 60, height: compact ? 32 : 40, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {e.thumbnailUrl && <img src={e.thumbnailUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ font: sans(compact ? 14 : 15, 600), lineHeight: 1.25 }}>
            {e.name}
            {e.hasVideo && <span style={{ font: mono(10, 600), color: 'var(--accent-text)', marginLeft: 6 }}>▶</span>}
          </span>
          <span style={{ font: mono(11.5, 500), color: 'var(--text-2)' }}>{targetLine(e)}</span>
          {e.notes && <span style={{ font: sans(12), color: 'var(--text-3)' }}>{e.notes}</span>}
        </span>
      </button>
      {action}
    </li>
  )
}

function plural(n: number): string {
  if (n === 1) return 'ćwiczenie'
  const last = n % 10
  const lastTwo = n % 100
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'ćwiczenia' : 'ćwiczeń'
}
