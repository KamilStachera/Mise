import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useQuestionnaire, useSaveAnswers } from '../api/hooks'
import type { Question } from '../api/client'
import { LoginPrompt } from '../components/LoginPrompt'
import { useIsMobile } from '../lib/useIsMobile'
import { Button, Chip, Eyebrow, PageTitle, inputStyle, sans, usePagePad } from '../components/ui'

export function Questionnaire() {
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { canEdit, isLoading: authLoading } = useAuth()
  const { data: q } = useQuestionnaire()
  const save = useSaveAnswers()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (q && !loaded) {
      setAnswers(q.answers)
      setLoaded(true)
    }
  }, [q, loaded])

  // Editing household answers is edit-only (the guard sits after all hooks).
  if (authLoading) return null
  if (!canEdit) return <LoginPrompt title="Ankieta kulinarna wymaga zalogowania" />

  if (!q) return <div style={{ ...pad, color: 'var(--text-3)' }}>Ładowanie…</div>

  const sections = q.sections
  const section = sections[step]
  const last = step === sections.length - 1

  function set(key: string, value: string) {
    setAnswers((a) => ({ ...a, [key]: value }))
  }

  function go(next: number) {
    setStep(next)
    document.querySelector('main')?.scrollTo({ top: 0 })
  }

  async function onFinish() {
    // Send every catalog key: empty strings clear answers that were removed.
    const full: Record<string, string> = {}
    for (const s of sections) for (const question of s.questions) full[question.key] = answers[question.key] ?? ''
    await save.mutateAsync(full)
    nav('/profile')
  }

  return (
    <div style={{ ...pad, maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 24 }}>
      <button type="button" onClick={() => nav('/profile')} style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: sans(14, 600), color: 'var(--text-2)' }}>
        ← {isMobile ? 'Ja' : 'Profil kulinarny'}
      </button>
      <Eyebrow tone="accent">Ankieta kulinarna · krok {step + 1} z {sections.length}</Eyebrow>
      <PageTitle title={section.title} size={isMobile ? 36 : 52} sub="Każde pytanie jest opcjonalne — odpowiedzi trafiają do cookbook.md, z którego korzysta każdy asystent." />

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sections.length}, 1fr)`, gap: 6 }}>
        {sections.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => go(i)}
            title={s.title}
            style={{ height: 3, padding: 0, border: 0, borderRadius: 2, cursor: 'pointer', background: i <= step ? 'var(--accent)' : 'var(--border)' }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--rule)' }}>
        {section.questions.map((question) => (
          <QuestionField key={question.key} question={question} value={answers[question.key] ?? ''} onChange={(v) => set(question.key, v)} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {step > 0 && <Button variant="quiet" size="lg" onClick={() => go(step - 1)}>← Wstecz</Button>}
        <span style={{ flex: 1 }} />
        {!last && !isMobile && <Button variant="text" onClick={() => go(step + 1)}>Pomiń sekcję</Button>}
        {last ? (
          <Button size="lg" onClick={onFinish} disabled={save.isPending}>{save.isPending ? 'Zapisywanie…' : 'Zapisz profil'}</Button>
        ) : (
          <Button size="lg" onClick={() => go(step + 1)}>Dalej →</Button>
        )}
      </div>
    </div>
  )
}

function QuestionField({ question, value, onChange }: { question: Question; value: string; onChange: (v: string) => void }) {
  const wrap = (control: ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ font: sans(15.5, 500), lineHeight: 1.4 }}>{question.label}</span>
      {control}
    </div>
  )

  switch (question.type) {
    case 'longtext':
      return wrap(
        <textarea
          style={{ ...inputStyle, height: 'auto', minHeight: 88, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder ?? ''}
        />,
      )
    case 'choice':
      return wrap(
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(question.options ?? []).map((opt) => (
            <Chip key={opt} active={value === opt} onClick={() => onChange(value === opt ? '' : opt)} style={{ font: sans(14, 500), padding: '8px 14px' }}>
              {opt}
            </Chip>
          ))}
        </div>,
      )
    case 'scale':
      return wrap(
        <div style={{ display: 'flex', gap: 6 }}>
          {['1', '2', '3', '4', '5'].map((n) => (
            <Chip key={n} active={value === n} onClick={() => onChange(value === n ? '' : n)} style={{ minWidth: 46, justifyContent: 'center', font: sans(14, 600), padding: '9px 0' }}>
              {n}
            </Chip>
          ))}
        </div>,
      )
    default:
      return wrap(<input style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)} placeholder={question.placeholder ?? ''} />)
  }
}
