import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { errorText } from '../../api/client'
import { useAuth } from '../../api/hooks'
import {
  useSaveTrainingProfile, useTrainingProfile,
  type Equipment, type ExerciseLevel, type TrainingGoal, type TrainingLocation, type TrainingProfileInput, type TrainingStyle,
} from '../../api/training'
import { TrainingNav } from '../../components/training/TrainingNav'
import { Button, Chip, PageTitle, inputStyle, sans, usePagePad } from '../../components/ui'
import {
  EXERCISE_LEVELS, HOME_EQUIPMENT, TRAINING_GOALS, TRAINING_STYLES,
  equipmentLabel, exerciseLevelLabel, trainingGoalLabel, trainingLocationLabel, trainingStyleLabel,
} from '../../lib/labels'
import { WEEKDAY_SHORT } from '../../lib/dates'
import { showToast } from '../../lib/toastBus'

const DEFAULTS: TrainingProfileInput = {
  goal: 'tone', level: 'beginner', daysPerWeek: 3, minutesPerSession: 45, preferredWeekdays: 0,
  location: 'home', homeEquipment: [], styles: ['strength'], limitations: '', dislikes: '', notes: '',
}

const MINUTES = [20, 30, 45, 60, 75, 90]

/** The training questionnaire — everything an agent needs to build her plan. One screen, chips. */
export function TrainingQuestionnaire() {
  const nav = useNavigate()
  const { canEdit, isLoading: authLoading } = useAuth()
  const { data: profile } = useTrainingProfile()
  const save = useSaveTrainingProfile()
  const pad = usePagePad()
  const [form, setForm] = useState<TrainingProfileInput>(DEFAULTS)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile?.configured) return
    const { configured: _c, updatedAt: _u, ...rest } = profile
    setForm(rest)
  }, [profile])

  if (!authLoading && !canEdit) return <Navigate to="/trening" replace />

  const set = <K extends keyof TrainingProfileInput>(key: K, value: TrainingProfileInput[K]) => setForm((f) => ({ ...f, [key]: value }))
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const toggleDay = (i: number) => set('preferredWeekdays', form.preferredWeekdays ^ (1 << i))
  const usesHome = form.location !== 'gym'

  const submit = () => {
    setError(null)
    save.mutate(form, {
      onSuccess: () => {
        showToast('Ankieta zapisana.')
        nav('/trening/plan')
      },
      onError: (e) => setError(errorText(e)),
    })
  }

  return (
    <div style={{ ...pad, maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 26 }}>
      <TrainingNav />
      <PageTitle title="Ankieta treningowa" sub="Na jej podstawie Sous (albo Claude Code) ułoży plan. Możesz ją zmienić w każdej chwili." />

      <Q title="Jaki masz cel?">
        {TRAINING_GOALS.map((g: TrainingGoal) => (
          <Chip key={g} active={form.goal === g} onClick={() => set('goal', g)}>{trainingGoalLabel[g]}</Chip>
        ))}
      </Q>

      <Q title="Jak oceniasz swoje doświadczenie?">
        {EXERCISE_LEVELS.map((l: ExerciseLevel) => (
          <Chip key={l} active={form.level === l} onClick={() => set('level', l)}>{exerciseLevelLabel[l]}</Chip>
        ))}
      </Q>

      <Q title="Ile dni w tygodniu?">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <Chip key={n} active={form.daysPerWeek === n} onClick={() => set('daysPerWeek', n)}>{n}</Chip>
        ))}
      </Q>

      <Q title="Ile minut na trening?">
        {MINUTES.map((m) => (
          <Chip key={m} active={form.minutesPerSession === m} onClick={() => set('minutesPerSession', m)}>{m} min</Chip>
        ))}
      </Q>

      <Q title="Które dni pasują?" hint="Nic nie zaznaczone = obojętnie.">
        {WEEKDAY_SHORT.map((w, i) => (
          <Chip key={w} active={(form.preferredWeekdays & (1 << i)) !== 0} onClick={() => toggleDay(i)}>{w}</Chip>
        ))}
      </Q>

      <Q title="Gdzie ćwiczysz?">
        {(['home', 'gym', 'any'] as TrainingLocation[]).map((l) => (
          <Chip key={l} active={form.location === l} onClick={() => set('location', l)}>{trainingLocationLabel[l]}</Chip>
        ))}
      </Q>

      {usesHome && (
        <Q title="Jaki sprzęt masz w domu?" hint="Ćwiczenia z masą ciała są zawsze w planie.">
          {HOME_EQUIPMENT.map((e: Equipment) => (
            <Chip key={e} active={form.homeEquipment.includes(e)} onClick={() => set('homeEquipment', toggle(form.homeEquipment, e))}>
              {equipmentLabel[e]}
            </Chip>
          ))}
        </Q>
      )}

      <Q title="Co lubisz?" hint="Pilates i joga mogą być dniami z pełnym filmem.">
        {TRAINING_STYLES.map((s: TrainingStyle) => (
          <Chip key={s} active={form.styles.includes(s)} onClick={() => set('styles', toggle(form.styles, s))}>{trainingStyleLabel[s]}</Chip>
        ))}
      </Q>

      <Q title="Kontuzje, bóle, ograniczenia" block>
        <textarea
          style={area}
          value={form.limitations}
          onChange={(e) => set('limitations', e.target.value)}
          placeholder="np. bolą mnie kolana przy głębokich przysiadach"
        />
      </Q>

      <Q title="Czego nie lubisz?" block>
        <textarea style={area} value={form.dislikes} onChange={(e) => set('dislikes', e.target.value)} placeholder="np. burpees, bieganie" />
      </Q>

      <Q title="Coś jeszcze?" block>
        <textarea style={area} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="np. chcę mocniejsze pośladki i plecy" />
      </Q>

      {error && <p role="alert" style={{ margin: 0, font: sans(13.5, 500), color: 'var(--accent-text)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <Button onClick={submit} disabled={save.isPending}>Zapisz ankietę</Button>
        <Button variant="quiet" onClick={() => nav(-1)}>Anuluj</Button>
      </div>
    </div>
  )
}

const area = { ...inputStyle, height: 'auto', minHeight: 72, padding: '10px 14px', resize: 'vertical' as const, lineHeight: 1.5, fontFamily: 'inherit' }

function Q({ title, hint, block, children }: { title: string; hint?: string; block?: boolean; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 21 }}>{title}</span>
        {hint && <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>{hint}</span>}
      </div>
      <div style={block ? undefined : { display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
    </section>
  )
}
