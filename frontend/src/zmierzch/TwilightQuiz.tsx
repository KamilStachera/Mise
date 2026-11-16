// /zmierzch — public, login-free trainer for "POP Quiz: Zmierzch" (Mova, Gdańsk, 28.11.2026).
// Rendered outside the app shell (App.tsx returns it before the auth gates) and makes no API
// calls; progress lives in localStorage on each phone. Temporary — see types.ts.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Eyebrow, PageTitle, SectionHead, Segmented, StatStrip, mono, sans, usePagePad } from '../components/ui'
import { FiltersPanel } from './FiltersPanel'
import { FlashRun } from './FlashRun'
import { QuizRun } from './QuizRun'
import { QUESTIONS } from './questions'
import { countStates, grade, loadProgress, saveProgress, type ProgressMap } from './progress'
import { applyFilters, loadFilters, pickSession, saveFilters, type Filters } from './queue'
import { PARTS, PART_LABEL, type Question } from './types'

type View = 'start' | 'quiz' | 'fiszki'

const EVENT = new Date(2026, 10, 28, 19, 0)

interface Session {
  mode: 'quiz' | 'fiszki'
  questions: Question[]
  seconds: number
  /** Remount key so "again" starts a fresh run. */
  n: number
}

export function TwilightQuiz() {
  const pad = usePagePad()
  const [view, setView] = useState<View>('start')
  const [progress, setProgress] = useState<ProgressMap>(loadProgress)
  const [filters, setFilters] = useState<Filters>(loadFilters)
  const [quizLen, setQuizLen] = useState<'10' | '20' | '45'>('20')
  const [quizSec, setQuizSec] = useState<'10' | '20' | '30' | '0'>('20')
  const [flashLen, setFlashLen] = useState<'10' | '20' | '40'>('20')
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => saveProgress(progress), [progress])
  useEffect(() => saveFilters(filters), [filters])
  useEffect(() => {
    document.title = 'Zmierzch · trening do quizu'
  }, [])

  const onGrade = useCallback((id: string, ok: boolean) => setProgress((p) => grade(p, id, ok)), [])
  const pool = useMemo(() => applyFilters(QUESTIONS, filters, progress), [filters, progress])

  const start = (mode: 'quiz' | 'fiszki') => {
    const size = Number(mode === 'quiz' ? quizLen : flashLen)
    const questions = pickSession(pool, progress, size, mode === 'quiz' ? 2 : 1.2)
    if (questions.length) setSession({ mode, questions, seconds: Number(quizSec), n: Date.now() })
  }
  const retry = (questions: Question[]) => session && setSession({ ...session, questions, n: Date.now() })
  const switchView = (v: View) => {
    setSession(null)
    setView(v)
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg)' }}>
      <div style={{ ...pad, maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <PageTitle
          title={<>Zmierzch<span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>.</span></>}
          count={QUESTIONS.length}
          // Compact header mid-session so the question sits high on a phone.
          size={session ? 34 : undefined}
          sub={session ? undefined : 'Trening przed POP Quizem w Movie — sobota 28.11, 19:00, Grunwaldzka 20/2a.'}
        />
        <Segmented<View>
          items={[
            { key: 'start', label: 'Start' },
            { key: 'quiz', label: 'Quiz' },
            { key: 'fiszki', label: 'Fiszki' },
          ]}
          value={view}
          onChange={switchView}
        />

        {view === 'start' && <StartView progress={progress} onReset={() => setProgress({})} onGo={switchView} />}

        {view !== 'start' && session && session.mode === 'quiz' && (
          <QuizRun key={session.n} questions={session.questions} seconds={session.seconds} onGrade={onGrade} onClose={() => setSession(null)} onRetry={retry} />
        )}
        {view !== 'start' && session && session.mode === 'fiszki' && (
          <FlashRun key={session.n} questions={session.questions} onGrade={onGrade} onClose={() => setSession(null)} onRetry={retry} />
        )}

        {view !== 'start' && !session && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <p style={{ margin: 0, font: sans(15), lineHeight: 1.5, color: 'var(--text-2)' }}>
              {view === 'quiz'
                ? 'Jak na prawdziwym quizie: cztery odpowiedzi i limit czasu. Brak odpowiedzi = błąd.'
                : 'Pytanie → odpowiedź → sama oceniasz. Czego nie wiesz, wraca kilka kart później, aż wejdzie.'}{' '}
              Najpierw lecą pytania, które sprawiały kłopot, i te jeszcze niewidziane.
            </p>
            {view === 'quiz' ? (
              <>
                <Option label="Liczba pytań">
                  <Segmented items={[{ key: '10', label: '10' }, { key: '20', label: '20' }, { key: '45', label: '45' }]} value={quizLen} onChange={setQuizLen} />
                </Option>
                <Option label="Czas na odpowiedź">
                  <Segmented
                    items={[{ key: '10', label: '10 s' }, { key: '20', label: '20 s' }, { key: '30', label: '30 s' }, { key: '0', label: 'bez' }]}
                    value={quizSec}
                    onChange={setQuizSec}
                  />
                </Option>
              </>
            ) : (
              <Option label="Kart w sesji">
                <Segmented items={[{ key: '10', label: '10' }, { key: '20', label: '20' }, { key: '40', label: '40' }]} value={flashLen} onChange={setFlashLen} />
              </Option>
            )}
            <Button size="xl" disabled={!pool.length} onClick={() => start(view)}>
              {view === 'quiz' ? 'Start quizu' : 'Zacznij fiszki'}
            </Button>
            <SectionHead title="Filtry" size={20} />
            <FiltersPanel value={filters} onChange={setFilters} poolSize={pool.length} />
          </div>
        )}
      </div>
    </div>
  )
}

function Option({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Eyebrow>{label}</Eyebrow>
      {children}
    </div>
  )
}

function StartView({ progress, onReset, onGo }: { progress: ProgressMap; onReset: () => void; onGo: (v: View) => void }) {
  const all = countStates(QUESTIONS, progress)
  const days = Math.ceil((EVENT.getTime() - Date.now()) / 86_400_000)
  const countdown = days > 1 ? `${days} dni` : days === 1 ? 'jutro' : days === 0 ? 'dziś' : 'po quizie'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <StatStrip
        items={[
          { value: countdown, label: 'do quizu', serif: true },
          { value: all.known, label: 'opanowane', highlight: all.known > 0 },
          { value: all.learning, label: 'w nauce' },
          { value: all.new, label: 'nowe' },
        ]}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Button size="xl" onClick={() => onGo('quiz')}>Quiz na czas</Button>
        <Button size="xl" variant="dark" onClick={() => onGo('fiszki')}>Fiszki</Button>
      </div>
      <div>
        <SectionHead title="Postęp według części" />
        {PARTS.map((p) => {
          const qs = QUESTIONS.filter((q) => q.part === p)
          const c = countStates(qs, progress)
          return (
            <div key={p} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span style={{ font: sans(15, 500) }}>{PART_LABEL[p]}</span>
                <span style={{ font: mono(12), color: 'var(--text-2)' }}>
                  {c.known}/{c.total} opanowane
                </span>
              </div>
              <Bar counts={c} />
            </div>
          )
        })}
      </div>
      <p style={{ margin: 0, font: sans(13), lineHeight: 1.5, color: 'var(--text-3)' }}>
        Postęp zapisuje się tylko na tym urządzeniu. Pytanie jest opanowane po trzech dobrych odpowiedziach z rzędu; jedna pomyłka cofa je na początek.
      </p>
      <div>
        <Button
          variant="text"
          onClick={() => {
            if (window.confirm('Wyzerować cały postęp na tym urządzeniu?')) onReset()
          }}
        >
          Resetuj postęp
        </Button>
      </div>
    </div>
  )
}

function Bar({ counts }: { counts: { total: number; known: number; learning: number } }) {
  const pct = (n: number) => (counts.total ? (n / counts.total) * 100 : 0)
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--seg-bg)' }}>
      <div style={{ width: `${pct(counts.known)}%`, background: 'var(--sage)' }} />
      <div style={{ width: `${pct(counts.learning)}%`, background: 'var(--gold)' }} />
    </div>
  )
}
