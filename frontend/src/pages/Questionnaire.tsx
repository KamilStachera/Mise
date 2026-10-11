import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useQuestionnaire, useSaveAnswers } from '../api/hooks'
import type { Question } from '../api/client'
import { BackIcon } from '../components/icons'
import { LoginPrompt } from '../components/LoginPrompt'

const cardStyle: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 15,
  padding: '22px 24px',
}
const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  borderRadius: 9,
  padding: '8px 11px',
  font: "400 14px var(--sans)",
  color: 'var(--text)',
}
const ghostBtn: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  borderRadius: 10,
  padding: '8px 14px',
  cursor: 'pointer',
  font: "500 13px var(--sans)",
}
const primaryBtn: CSSProperties = {
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  borderRadius: 10,
  padding: '8px 16px',
  cursor: 'pointer',
  font: "600 13px var(--sans)",
}

export function Questionnaire() {
  const nav = useNavigate()
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

  if (!q) return <div style={{ padding: 40, color: 'var(--text-3)', maxWidth: 760, margin: '0 auto' }}>Ładowanie…</div>

  const sections = q.sections
  const section = sections[step]
  const last = step === sections.length - 1

  function set(key: string, value: string) {
    setAnswers((a) => ({ ...a, [key]: value }))
  }

  async function onFinish() {
    // Send every catalog key: empty strings clear answers that were removed.
    const full: Record<string, string> = {}
    for (const s of sections) for (const question of s.questions) full[question.key] = answers[question.key] ?? ''
    await save.mutateAsync(full)
    nav('/profile')
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '30px 42px 60px' }}>
      <button
        onClick={() => nav('/profile')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', font: "500 13.5px var(--sans)", padding: '6px 0', marginBottom: 14 }}
      >
        <BackIcon /> Profil kulinarny
      </button>

      <div style={{ font: "600 11px var(--sans)", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 7 }}>
        Ankieta kulinarna · krok {step + 1} z {sections.length}
      </div>
      <h1 style={{ fontFamily: "var(--serif)", fontWeight: 600, fontSize: 34, margin: '0 0 6px' }}>{section.title}</h1>
      <p style={{ fontSize: 14, color: 'var(--text-2)', margin: '0 0 20px', maxWidth: '62ch' }}>
        Każde pytanie jest opcjonalne — odpowiedzi trafiają do cookbook.md, z którego korzysta każdy asystent.
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {sections.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setStep(i)}
            title={s.title}
            style={{
              flex: 1,
              height: 5,
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              background: i === step ? 'var(--accent)' : i < step ? 'var(--accent-soft)' : 'var(--border)',
              padding: 0,
            }}
          />
        ))}
      </div>

      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {section.questions.map((question) => (
          <QuestionField key={question.key} question={question} value={answers[question.key] ?? ''} onChange={(v) => set(question.key, v)} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 20, alignItems: 'center' }}>
        {step > 0 && <button style={ghostBtn} onClick={() => setStep((s) => s - 1)}>‹ Wstecz</button>}
        <div style={{ flex: 1 }} />
        {!last && (
          <button style={ghostBtn} onClick={() => setStep((s) => s + 1)}>Pomiń sekcję</button>
        )}
        {last ? (
          <button style={primaryBtn} onClick={onFinish}>{save.isPending ? 'Zapisywanie…' : 'Zapisz profil'}</button>
        ) : (
          <button style={primaryBtn} onClick={() => setStep((s) => s + 1)}>Dalej ›</button>
        )}
      </div>
    </div>
  )
}

function QuestionField({ question, value, onChange }: { question: Question; value: string; onChange: (v: string) => void }) {
  const label = (
    <div style={{ font: "500 14px var(--sans)", color: 'var(--text)', marginBottom: 8 }}>{question.label}</div>
  )

  const pill = (selected: boolean): CSSProperties => ({
    font: "500 13px var(--sans)",
    padding: '8px 13px',
    borderRadius: 9,
    background: selected ? 'var(--accent-soft)' : 'var(--surface)',
    border: '1px solid ' + (selected ? 'var(--accent)' : 'var(--border)'),
    color: selected ? 'var(--accent-deep)' : 'var(--text)',
    cursor: 'pointer',
  })

  switch (question.type) {
    case 'longtext':
      return (
        <div>
          {label}
          <textarea
            style={{ ...inputStyle, minHeight: 76, resize: 'vertical', lineHeight: 1.5 }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder ?? ''}
          />
        </div>
      )
    case 'choice':
      return (
        <div>
          {label}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(question.options ?? []).map((opt) => (
              <button key={opt} style={pill(value === opt)} onClick={() => onChange(value === opt ? '' : opt)}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      )
    case 'scale':
      return (
        <div>
          {label}
          <div style={{ display: 'flex', gap: 8 }}>
            {['1', '2', '3', '4', '5'].map((n) => (
              <button key={n} style={{ ...pill(value === n), minWidth: 42, textAlign: 'center' }} onClick={() => onChange(value === n ? '' : n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )
    default:
      return (
        <div>
          {label}
          <input style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)} placeholder={question.placeholder ?? ''} />
        </div>
      )
  }
}
