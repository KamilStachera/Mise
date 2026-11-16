import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Eyebrow, SectionHead, mono, sans } from '../components/ui'
import { shuffle } from './queue'
import { CATEGORY_LABEL, PART_LABEL, SOURCE_LABEL, type Question } from './types'

const TIMEOUT = '__timeout__'
const LETTERS = ['A', 'B', 'C', 'D']

interface Result {
  q: Question
  picked: string
}

/** One timed ABCD round. `seconds` = 0 means no time limit. */
export function QuizRun({ questions, seconds, onGrade, onClose, onRetry }: {
  questions: Question[]
  seconds: number
  onGrade: (id: string, correct: boolean) => void
  onClose: () => void
  onRetry: (questions: Question[]) => void
}) {
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [deadline, setDeadline] = useState(0)
  const [now, setNow] = useState(Date.now())

  const q = questions[idx] as Question | undefined
  const options = useMemo(() => (q ? shuffle([q.answer, ...q.wrong]) : []), [q])
  const done = idx >= questions.length

  useEffect(() => {
    if (done || !seconds) return
    setDeadline(Date.now() + seconds * 1000)
    setNow(Date.now())
  }, [idx, done, seconds])

  const answer = useCallback(
    (choice: string) => {
      if (!q || picked !== null) return
      setPicked(choice)
      setResults((r) => [...r, { q, picked: choice }])
      onGrade(q.id, choice === q.answer)
    },
    [q, picked, onGrade],
  )

  const next = useCallback(() => {
    setPicked(null)
    setDeadline(0) // the countdown waits for the next question's deadline
    setIdx((i) => i + 1)
  }, [])

  // Countdown: a missed deadline counts as a wrong answer.
  useEffect(() => {
    if (done || !seconds || picked !== null || !deadline) return
    const t = setInterval(() => {
      const n = Date.now()
      setNow(n)
      if (n >= deadline) answer(TIMEOUT)
    }, 100)
    return () => clearInterval(t)
  }, [done, seconds, picked, deadline, answer])

  // Keyboard on desktop: 1–4 / A–D pick, Enter goes on.
  useEffect(() => {
    if (done) return
    const onKey = (e: KeyboardEvent) => {
      if (picked === null) {
        const i = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(e.key.toLowerCase())
        if (i >= 0 && options[i]) answer(options[i])
      } else if (e.key === 'Enter') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [done, picked, options, answer, next])

  if (done || !q) {
    const correct = results.filter((r) => r.picked === r.q.answer).length
    const missed = results.filter((r) => r.picked !== r.q.answer)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span style={{ font: mono(56, 500), lineHeight: 1 }}>{correct}/{results.length}</span>
          <span style={{ font: sans(16), color: 'var(--text-2)' }}>{verdict(correct, results.length)}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {missed.length > 0 && <Button onClick={() => onRetry(missed.map((m) => m.q))}>Powtórz błędy ({missed.length})</Button>}
          <Button variant="outline" onClick={() => onRetry(shuffle(questions))}>Jeszcze raz te same</Button>
          <Button variant="quiet" onClick={onClose}>Nowa runda</Button>
        </div>
        {missed.length > 0 && (
          <div>
            <SectionHead title="Do poprawy" meta={missed.length} />
            {missed.map(({ q: m, picked: p }) => (
              <div key={m.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ font: sans(15, 500) }}>{m.q}</span>
                <span style={{ font: sans(14), color: 'var(--accent-text)' }}>
                  {p === TIMEOUT ? 'Czas minął' : <s>{p}</s>}
                </span>
                <span style={{ font: sans(14, 600), color: 'var(--sage-text)' }}>✓ {m.answer}</span>
                {m.note && <span style={{ font: sans(13), color: 'var(--text-2)', lineHeight: 1.45 }}>{m.note}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const left = seconds ? Math.max(0, deadline - now) : 0
  const frac = seconds && deadline ? left / (seconds * 1000) : 1
  const score = results.filter((r) => r.picked === r.q.answer).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ font: mono(13, 500), color: 'var(--text-2)' }}>
          {idx + 1}/{questions.length} · wynik {score}
        </span>
        <button type="button" onClick={onClose} style={{ border: 0, background: 'transparent', font: sans(14), color: 'var(--text-3)', cursor: 'pointer' }}>
          Zakończ
        </button>
      </div>
      {seconds > 0 && (
        <div style={{ height: 4, borderRadius: 2, background: 'var(--seg-bg)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              // Freezes where the answer landed (the countdown stops ticking).
              width: `${frac * 100}%`,
              background: frac < 0.3 ? 'var(--accent)' : 'var(--text)',
              transition: 'width .1s linear',
            }}
          />
        </div>
      )}
      <Eyebrow>
        {PART_LABEL[q.part]} · {SOURCE_LABEL[q.source]} · {CATEGORY_LABEL[q.category]}
        {q.difficulty === 3 ? ' · trudne' : ''}
      </Eyebrow>
      <div style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 24, lineHeight: 1.25, textWrap: 'pretty' as never }}>{q.q}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((o, i) => {
          const isAnswer = o === q.answer
          const isPicked = o === picked
          const revealed = picked !== null
          return (
            <button
              key={o}
              type="button"
              onClick={() => answer(o)}
              disabled={revealed}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                minHeight: 54,
                padding: '10px 14px',
                borderRadius: 12,
                textAlign: 'left',
                cursor: revealed ? 'default' : 'pointer',
                font: sans(16),
                color: 'var(--text)',
                border: revealed && isAnswer ? '2px solid var(--sage)' : revealed && isPicked ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: revealed && isPicked && !isAnswer ? 'var(--accent-soft)' : 'var(--surface)',
                opacity: revealed && !isAnswer && !isPicked ? 0.55 : 1,
              }}
            >
              <span style={{ font: mono(13, 500), color: 'var(--text-3)', width: 14 }}>{LETTERS[i]}</span>
              <span style={{ flex: 1 }}>{o}</span>
              {revealed && isAnswer && <span style={{ color: 'var(--sage-text)', fontWeight: 700 }}>✓</span>}
            </button>
          )
        })}
      </div>
      {picked !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ font: sans(15, 600), color: picked === q.answer ? 'var(--sage-text)' : 'var(--accent-text)' }}>
            {picked === q.answer ? 'Dobrze!' : picked === TIMEOUT ? 'Czas minął.' : 'Niestety.'}
          </span>
          {q.note && <span style={{ font: sans(15), lineHeight: 1.5, color: 'var(--text-2)' }}>{q.note}</span>}
          <Button variant="dark" size="lg" onClick={next} autoFocus>
            {idx + 1 < questions.length ? 'Dalej' : 'Wynik'}
          </Button>
        </div>
      )}
    </div>
  )
}

function verdict(c: number, n: number) {
  const r = n ? c / n : 0
  if (r === 1) return 'Komplet. Volturi byliby dumni.'
  if (r >= 0.8) return 'Bardzo mocno.'
  if (r >= 0.6) return 'Nieźle, ale jeszcze kawałek.'
  if (r >= 0.4) return 'Jest nad czym pracować.'
  return 'Czas wrócić do książek.'
}
