import { useEffect, useState } from 'react'
import { Button, Eyebrow, SectionHead, mono, sans } from '../components/ui'
import { CATEGORY_LABEL, PART_LABEL, SOURCE_LABEL, type Question } from './types'

/** A missed card comes back this many cards later in the same session. */
const REPEAT_AFTER = 3

/** Flashcards: reveal, then self-grade. Missed cards return until known. */
export function FlashRun({ questions, onGrade, onClose, onRetry }: {
  questions: Question[]
  onGrade: (id: string, correct: boolean) => void
  onClose: () => void
  onRetry: (questions: Question[]) => void
}) {
  const [queue, setQueue] = useState<Question[]>(questions)
  const [revealed, setRevealed] = useState(false)
  /** First-attempt result per card. */
  const [first, setFirst] = useState<Record<string, boolean>>({})

  const q = queue[0] as Question | undefined

  const grade = (ok: boolean) => {
    if (!q) return
    onGrade(q.id, ok)
    setFirst((f) => (q.id in f ? f : { ...f, [q.id]: ok }))
    setRevealed(false)
    setQueue((rest) => {
      const tail = rest.slice(1)
      if (ok) return tail
      const at = Math.min(REPEAT_AFTER, tail.length)
      return [...tail.slice(0, at), q, ...tail.slice(at)]
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q) return
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed && (e.key === '1' || e.key === 'ArrowLeft')) grade(false)
      else if (revealed && (e.key === '2' || e.key === 'ArrowRight')) grade(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!q) {
    const missed = questions.filter((x) => first[x.id] === false)
    const ok = questions.length - missed.length
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span style={{ font: mono(56, 500), lineHeight: 1 }}>{ok}/{questions.length}</span>
          <span style={{ font: sans(16), color: 'var(--text-2)' }}>za pierwszym razem</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {missed.length > 0 && <Button onClick={() => onRetry(missed)}>Jeszcze raz trudne ({missed.length})</Button>}
          <Button variant="quiet" onClick={onClose}>Nowa sesja</Button>
        </div>
        {missed.length > 0 && (
          <div>
            <SectionHead title="Sprawiły kłopot" meta={missed.length} />
            {missed.map((m) => (
              <div key={m.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ font: sans(15, 500) }}>{m.q}</span>
                <span style={{ font: sans(14, 600), color: 'var(--sage-text)' }}>{m.answer}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const doneCount = Object.keys(first).length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ font: mono(13, 500), color: 'var(--text-2)' }}>
          {doneCount}/{questions.length} · w kolejce {queue.length}
        </span>
        <button type="button" onClick={onClose} style={{ border: 0, background: 'transparent', font: sans(14), color: 'var(--text-3)', cursor: 'pointer' }}>
          Zakończ
        </button>
      </div>
      <div
        style={{
          borderTop: '1px solid var(--rule)',
          borderBottom: '1px solid var(--rule)',
          padding: '22px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          minHeight: 220,
        }}
      >
        <Eyebrow>
          {PART_LABEL[q.part]} · {SOURCE_LABEL[q.source]} · {CATEGORY_LABEL[q.category]}
          {q.difficulty === 1 ? ' · łatwe' : q.difficulty === 3 ? ' · trudne' : ''}
        </Eyebrow>
        <div style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 24, lineHeight: 1.25, textWrap: 'pretty' as never }}>{q.q}</div>
        {revealed && (
          <>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontStyle: 'italic', color: 'var(--accent-text)' }}>{q.answer}</div>
            {q.note && <div style={{ font: sans(15), lineHeight: 1.5, color: 'var(--text-2)' }}>{q.note}</div>}
          </>
        )}
      </div>
      {revealed ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="outline" size="xl" onClick={() => grade(false)}>Nie wiedziałam</Button>
          <Button variant="dark" size="xl" onClick={() => grade(true)}>Wiedziałam</Button>
        </div>
      ) : (
        <Button size="xl" onClick={() => setRevealed(true)}>Pokaż odpowiedź</Button>
      )}
    </div>
  )
}
