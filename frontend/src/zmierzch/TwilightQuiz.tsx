// /zmierzch — Twilight quiz trainer ("POP Quiz: Zmierzch", Mova Gdańsk, 28.11.2026).
// Rendered outside the app shell (App.tsx returns it before the auth gates). Works without
// login via localStorage; signed-in Google users (including friends outside any Pichci
// household) get cloud progress sync and leaderboards per whole suite, saga part and set.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, loginUrl } from '../api/client'
import { useAuth } from '../api/hooks'
import { Button, Eyebrow, PageTitle, SectionHead, Segmented, StatStrip, Toggle, UnderlineTabs, mono, sans, usePagePad } from '../components/ui'
import {
  useRecordZmierzchAttempt,
  useZmierzchLeaderboard,
  useZmierzchMe,
  zmierzchApi,
} from './api'
import { FiltersPanel } from './FiltersPanel'
import { FlashRun } from './FlashRun'
import { Avatar, LeaderboardView } from './LeaderboardView'
import { QuizRun } from './QuizRun'
import { QUESTIONS } from './questions'
import {
  countStates,
  enrichWithParts,
  grade,
  loadProgress,
  mergeProgress,
  saveProgress,
  type ProgressMap,
} from './progress'
import {
  DEFAULT_FILTERS,
  applyFilters,
  isMovieQuestion,
  loadFilters,
  loadMoviesOnly,
  pickSession,
  resolveQuizScope,
  saveFilters,
  saveMoviesOnly,
  shuffle,
  type Filters,
} from './queue'
import { SetsView } from './SetsView'
import { resolveSetQuestions, scopeLabel, type QuizSet } from './sets'
import { PARTS, PART_LABEL, type Part, type Question } from './types'

type View = 'start' | 'zestawy' | 'quiz' | 'fiszki' | 'ranking'

const EVENT = new Date(2026, 10, 28, 19, 0)
const PART_BY_ID = new Map<string, Part>(QUESTIONS.map((q) => [q.id, q.part]))

interface Session {
  mode: 'quiz' | 'fiszki'
  questions: Question[]
  seconds: number
  scope: string
  title?: string
  /** Remount key so "again" starts a fresh run. */
  n: number
}

export function TwilightQuiz() {
  const pad = usePagePad()
  const qc = useQueryClient()
  const { data: auth } = useAuth()
  const isLoggedIn = auth?.signedIn === true && !auth?.blocked

  const [view, setView] = useState<View>('start')
  const [boardScope, setBoardScope] = useState<string>('all')
  const [moviesOnly, setMoviesOnly] = useState<boolean>(loadMoviesOnly)
  const [progress, setProgress] = useState<ProgressMap>(() => enrichWithParts(loadProgress(), QUESTIONS))
  const [filters, setFilters] = useState<Filters>(loadFilters)
  const [quizLen, setQuizLen] = useState<'10' | '20' | '45'>('20')
  const [quizSec, setQuizSec] = useState<'10' | '20' | '30' | '0'>('20')
  const [flashLen, setFlashLen] = useState<'10' | '20' | '40'>('20')
  const [session, setSession] = useState<Session | null>(null)

  const meQuery = useZmierzchMe(isLoggedIn)
  const overviewBoard = useZmierzchLeaderboard('all', isLoggedIn && view === 'zestawy')
  const recordAttempt = useRecordZmierzchAttempt()

  const progressRef = useRef(progress)
  progressRef.current = progress
  const hydratedRef = useRef(false)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)

  useEffect(() => saveProgress(progress), [progress])
  useEffect(() => saveFilters(filters), [filters])
  useEffect(() => saveMoviesOnly(moviesOnly), [moviesOnly])
  useEffect(() => {
    const prev = document.title
    document.title = 'Zmierzch · trening do quizu'
    return () => { document.title = prev }
  }, [])

  // Merge cloud progress once upon signing in.
  useEffect(() => {
    if (!isLoggedIn) {
      hydratedRef.current = false
      return
    }
    if (!meQuery.data || hydratedRef.current) return
    hydratedRef.current = true
    const remote = enrichWithParts(meQuery.data.progress ?? {}, QUESTIONS)
    const local = enrichWithParts(progressRef.current, QUESTIONS)
    const merged = mergeProgress(remote, local)
    setProgress(merged)
    progressRef.current = merged
    if (JSON.stringify(merged) !== JSON.stringify(remote) && Object.keys(merged).length > 0) {
      void zmierzchApi.syncProgress(merged, 'merge').then(() => {
        void qc.invalidateQueries({ queryKey: ['zmierzch', 'leaderboard'] })
      }).catch(() => { /* best effort */ })
    }
  }, [isLoggedIn, meQuery.data, qc])

  const flushSync = useCallback(async () => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
    if (!isLoggedIn || !dirtyRef.current) return
    dirtyRef.current = false
    try {
      await zmierzchApi.syncProgress(enrichWithParts(progressRef.current, QUESTIONS), 'merge')
      void qc.invalidateQueries({ queryKey: ['zmierzch', 'leaderboard'] })
    } catch {
      dirtyRef.current = true
    }
  }, [isLoggedIn, qc])

  useEffect(() => () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
  }, [])

  const onGrade = useCallback((id: string, ok: boolean) => {
    const part = PART_BY_ID.get(id)
    setProgress((p) => {
      const next = grade(p, id, ok, part)
      progressRef.current = next
      return next
    })
    if (isLoggedIn) {
      dirtyRef.current = true
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => { void flushSync() }, 800)
    }
  }, [isLoggedIn, flushSync])

  const activeQuestions = useMemo(
    () => (moviesOnly ? QUESTIONS.filter(isMovieQuestion) : QUESTIONS),
    [moviesOnly],
  )
  const pool = useMemo(
    () => applyFilters(QUESTIONS, filters, progress, moviesOnly),
    [filters, progress, moviesOnly],
  )
  const currentQuizScope = useMemo(
    () => resolveQuizScope(filters, moviesOnly),
    [filters, moviesOnly],
  )

  const handleToggleMoviesOnly = (on: boolean) => {
    setMoviesOnly(on)
    if (on && filters.categories.includes('roznice')) {
      setFilters((f) => ({ ...f, categories: f.categories.filter((c) => c !== 'roznice') }))
    }
  }

  const start = (mode: 'quiz' | 'fiszki') => {
    const size = Number(mode === 'quiz' ? quizLen : flashLen)
    const questions = pickSession(pool, progress, size, mode === 'quiz' ? 2 : 1.2)
    if (!questions.length) return
    setSession({
      mode,
      questions,
      seconds: mode === 'quiz' ? Number(quizSec) : 0,
      scope: mode === 'quiz' ? currentQuizScope : 'custom',
      n: Date.now(),
    })
  }

  const startSet = (set: QuizSet) => {
    const questions = shuffle(resolveSetQuestions(set, QUESTIONS))
    if (!questions.length) return
    setView('zestawy')
    setSession({
      mode: 'quiz',
      questions,
      seconds: set.seconds,
      scope: set.scope,
      title: set.title,
      n: Date.now(),
    })
  }

  const startPart = (part: Part | null) => {
    setSession(null)
    setFilters({ ...DEFAULT_FILTERS, parts: part ? [part] : [] })
    setView('quiz')
  }

  const retry = (questions: Question[]) => {
    if (!session) return
    // Retrying only missed questions is practice, not a full ranked run of the set/scope.
    const isFullRetry = questions.length === session.questions.length
    setSession({
      ...session,
      questions,
      scope: isFullRetry ? session.scope : 'custom',
      title: isFullRetry ? session.title : session.title ? `${session.title} · powtórka` : undefined,
      n: Date.now(),
    })
  }

  const closeSession = () => {
    void flushSync()
    setSession(null)
  }

  const switchView = (v: View) => {
    void flushSync()
    setSession(null)
    setView(v)
  }

  const openLeaderboard = (scope: string) => {
    void flushSync()
    setSession(null)
    setBoardScope(scope === 'custom' ? 'all' : scope)
    setView('ranking')
  }

  const handleCompleteQuiz = useCallback(
    async (summary: { correct: number; total: number; durationMs: number }) => {
      if (!session || !isLoggedIn) return null
      await flushSync()
      return await recordAttempt.mutateAsync({
        scope: session.scope,
        correct: summary.correct,
        total: summary.total,
        durationMs: summary.durationMs,
        timeLimitSeconds: session.seconds,
      })
    },
    [session, isLoggedIn, flushSync, recordAttempt],
  )

  const handleReset = async () => {
    const msg = isLoggedIn
      ? 'Wyzerować cały postęp nauki (opanowanie pytań) na koncie? Zapisane rekordy w rankingu pozostaną.'
      : 'Wyzerować cały postęp na tym urządzeniu?'
    if (!window.confirm(msg)) return
    setProgress({})
    progressRef.current = {}
    dirtyRef.current = false
    if (isLoggedIn) {
      try {
        await zmierzchApi.syncProgress({}, 'replace')
        void qc.invalidateQueries({ queryKey: ['zmierzch'] })
      } catch { /* ignore */ }
    }
  }

  const handleLogout = async () => {
    await flushSync()
    await api.logout()
    await qc.invalidateQueries({ queryKey: ['auth'] })
    await qc.invalidateQueries({ queryKey: ['zmierzch'] })
  }

  const displayName = meQuery.data?.displayName ?? auth?.name ?? 'Gracz'
  const picture = meQuery.data?.picture ?? auth?.picture ?? null
  const personalBests = meQuery.data?.personalBests ?? {}
  const scopeCounts = overviewBoard.data?.scopeCounts ?? {}
  const showBackToPichci = !isLoggedIn || auth?.authenticated || auth?.publicHousehold

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg)' }}>
      <div style={{ ...pad, maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {!session && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: -8 }}>
            {showBackToPichci ? (
              <Link to="/" style={{ font: sans(14), color: 'var(--text-3)' }}>
                ← Pichci
              </Link>
            ) : <span />}
            {isLoggedIn ? (
              <button
                type="button"
                onClick={() => switchView('ranking')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 10px 4px 4px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  font: sans(13, 500),
                  cursor: 'pointer',
                }}
              >
                <Avatar name={displayName} picture={picture} size={24} />
                <span>{displayName}</span>
              </button>
            ) : (
              <a
                href={loginUrl('/zmierzch')}
                style={{ font: sans(13, 600), color: 'var(--accent-text)', textDecoration: 'none' }}
              >
                Zaloguj przez Google →
              </a>
            )}
          </div>
        )}

        <PageTitle
          title={<>Zmierzch<span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>.</span></>}
          count={activeQuestions.length}
          // Compact header mid-session so the question sits high on a phone.
          size={session ? 34 : undefined}
          sub={session ? undefined : 'Trening przed POP Quizem w Movie — sobota 28.11, 19:00, Grunwaldzka 20/2a.'}
        />

        {!session && (
          <div
            onClick={() => handleToggleMoviesOnly(!moviesOnly)}
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              border: `1px solid ${moviesOnly ? 'var(--sage)' : 'var(--border)'}`,
              background: moviesOnly ? 'var(--accent-soft)' : 'var(--surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ font: sans(14, 600), color: 'var(--text)' }}>Tylko filmy</span>
              <span style={{ font: sans(12), color: 'var(--text-2)' }}>
                {moviesOnly
                  ? `Wykluczono pytania o książki i różnice (${activeQuestions.length} z ${QUESTIONS.length} pytań)`
                  : `Wyklucz pytania książkowe i ćwicz wyłącznie pod filmy (${QUESTIONS.length} pytań)`}
              </span>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <Toggle on={moviesOnly} onChange={handleToggleMoviesOnly} />
            </div>
          </div>
        )}

        <UnderlineTabs<View>
          items={[
            { key: 'start', label: 'Start' },
            { key: 'zestawy', label: 'Zestawy' },
            { key: 'quiz', label: 'Quiz' },
            { key: 'fiszki', label: 'Fiszki' },
            { key: 'ranking', label: 'Ranking' },
          ]}
          value={view}
          onChange={switchView}
        />

        {session && session.mode === 'quiz' && (
          <QuizRun
            key={session.n}
            questions={session.questions}
            seconds={session.seconds}
            scope={session.scope}
            title={session.title}
            isLoggedIn={isLoggedIn}
            onGrade={onGrade}
            onComplete={handleCompleteQuiz}
            onOpenLeaderboard={openLeaderboard}
            onClose={closeSession}
            onRetry={retry}
          />
        )}

        {session && session.mode === 'fiszki' && (
          <FlashRun
            key={session.n}
            questions={session.questions}
            onGrade={onGrade}
            onClose={closeSession}
            onRetry={retry}
          />
        )}

        {!session && view === 'start' && (
          <StartView
            questions={activeQuestions}
            progress={progress}
            isLoggedIn={isLoggedIn}
            onReset={() => void handleReset()}
            onGo={switchView}
            onStartPart={startPart}
          />
        )}

        {!session && view === 'zestawy' && (
          <SetsView
            isLoggedIn={isLoggedIn}
            moviesOnly={moviesOnly}
            personalBests={personalBests}
            scopeCounts={scopeCounts}
            onStartSet={startSet}
            onOpenLeaderboard={openLeaderboard}
          />
        )}

        {!session && view === 'ranking' && (
          <LeaderboardView
            isLoggedIn={isLoggedIn}
            moviesOnly={moviesOnly}
            displayName={displayName}
            picture={picture}
            scope={boardScope}
            onScopeChange={setBoardScope}
            onStartSet={startSet}
            onStartPart={startPart}
            onLogout={() => void handleLogout()}
          />
        )}

        {!session && (view === 'quiz' || view === 'fiszki') && (
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
                <div style={{ font: mono(12), color: currentQuizScope === 'custom' ? 'var(--text-3)' : 'var(--sage-text)' }}>
                  {currentQuizScope === 'custom'
                    ? 'Tryb treningowy (dodatkowe filtry nie liczą się do rankingu rund)'
                    : `Wynik liczy się do rankingu: ${scopeLabel(currentQuizScope)}`}
                </div>
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
            <FiltersPanel value={filters} onChange={setFilters} poolSize={pool.length} moviesOnly={moviesOnly} />
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

function StartView({
  questions,
  progress,
  isLoggedIn,
  onReset,
  onGo,
  onStartPart,
}: {
  questions: Question[]
  progress: ProgressMap
  isLoggedIn: boolean
  onReset: () => void
  onGo: (v: View) => void
  onStartPart: (part: Part | null) => void
}) {
  const all = countStates(questions, progress)
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
        <Button size="xl" onClick={() => onGo('zestawy')}>Zestawy</Button>
        <Button size="xl" variant="dark" onClick={() => onGo('quiz')}>Quiz na czas</Button>
        <Button size="lg" variant="outline" onClick={() => onGo('fiszki')}>Fiszki</Button>
        <Button size="lg" variant="quiet" onClick={() => onGo('ranking')}>Ranking</Button>
      </div>

      {!isLoggedIn && (
        <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ font: sans(14), color: 'var(--text-2)' }}>
            Zaloguj się przez Google, żeby synchronizować postęp i rywalizować w rankingu.
          </span>
          <a href={loginUrl('/zmierzch')} style={{ textDecoration: 'none' }}>
            <Button size="sm" variant="dark" type="button">Zaloguj przez Google</Button>
          </a>
        </div>
      )}

      <div>
        <SectionHead title="Postęp według części" />
        {PARTS.map((p) => {
          const qs = questions.filter((q) => q.part === p)
          const c = countStates(qs, progress)
          return (
            <div key={p} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span style={{ font: sans(15, 500) }}>{PART_LABEL[p]}</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <span style={{ font: mono(12), color: 'var(--text-2)' }}>
                    {c.known}/{c.total} opanowane
                  </span>
                  <button
                    type="button"
                    onClick={() => onStartPart(p)}
                    style={{ border: 0, background: 'transparent', padding: 0, font: sans(13, 600), color: 'var(--accent-text)', cursor: 'pointer' }}
                  >
                    Quiz →
                  </button>
                </div>
              </div>
              <Bar counts={c} />
            </div>
          )
        })}
      </div>
      <p style={{ margin: 0, font: sans(13), lineHeight: 1.5, color: 'var(--text-3)' }}>
        {isLoggedIn
          ? 'Postęp synchronizuje się z Twoim kontem Google i liczy się do rankingu opanowania. Pytanie jest opanowane po trzech dobrych odpowiedziach z rzędu; jedna pomyłka cofa je na początek.'
          : 'Bez logowania postęp zapisuje się tylko na tym urządzeniu. Pytanie jest opanowane po trzech dobrych odpowiedziach z rzędu; jedna pomyłka cofa je na początek.'}
      </p>
      <div>
        <Button variant="text" onClick={onReset}>
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
