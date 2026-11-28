import { useState } from 'react'
import { loginUrl } from '../api/client'
import { Button, Chip, Eyebrow, SectionHead, Segmented, mono, sans } from '../components/ui'
import {
  formatDurationMs,
  useUpdateZmierzchProfile,
  useZmierzchLeaderboard,
  type ZmierzchMasteryLeader,
  type ZmierzchRunLeader,
} from './api'
import { QUESTIONS } from './questions'
import { isMovieQuestion } from './queue'
import { QUIZ_SETS, findSetByScope, isMovieOnlySet, scopeLabel, type QuizSet } from './sets'
import { PARTS, PART_LABEL, type Part } from './types'

type BoardMode = 'runs' | 'mastery'

export function LeaderboardView({
  isLoggedIn,
  moviesOnly,
  displayName,
  picture,
  scope,
  onScopeChange,
  onStartSet,
  onStartPart,
  onLogout,
}: {
  isLoggedIn: boolean
  moviesOnly: boolean
  displayName: string
  picture: string | null
  scope: string
  onScopeChange: (s: string) => void
  onStartSet: (set: QuizSet) => void
  onStartPart: (part: Part | null) => void
  onLogout: () => void
}) {
  const [mode, setMode] = useState<BoardMode>('runs')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(displayName)
  const updateProfile = useUpdateZmierzchProfile()
  const { data, isLoading, error, refetch } = useZmierzchLeaderboard(scope, isLoggedIn)

  if (!isLoggedIn) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '18px 0' }}>
        <SectionHead title="Ranking dla zalogowanych" />
        <p style={{ margin: 0, font: sans(15), lineHeight: 1.55, color: 'var(--text-2)' }}>
          Zaloguj się przez Google, żeby zobaczyć tablicę wyników (dla całego banku, każdej części sagi i każdego zestawu egzaminacyjnego) oraz zsynchronizować postęp między telefonem a komputerem.
        </p>
        <p style={{ margin: 0, font: sans(14), lineHeight: 1.5, color: 'var(--text-3)' }}>
          Działa dla każdego konta Google — znajomi nie muszą mieć zaproszenia do Pichci.
        </p>
        <div>
          <a href={loginUrl('/zmierzch')} style={{ textDecoration: 'none' }}>
            <Button size="lg" variant="dark" type="button">Zaloguj się przez Google</Button>
          </a>
        </div>
      </div>
    )
  }

  const isFixedSet = scope.startsWith('set:')
  const activeMode: BoardMode = isFixedSet ? 'runs' : mode
  const activeQuestions = moviesOnly ? QUESTIONS.filter(isMovieQuestion) : QUESTIONS
  const visibleSets = moviesOnly
    ? QUIZ_SETS.filter((s) => isMovieOnlySet(s, QUESTIONS) || s.scope === scope)
    : QUIZ_SETS
  const scopeTotalQuestions = scope === 'all'
    ? activeQuestions.length
    : scope.startsWith('part:')
      ? activeQuestions.filter((q) => q.part === scope.slice('part:'.length)).length
      : (findSetByScope(scope)?.questionIds.length ?? 0)
  const counts = data?.scopeCounts ?? {}

  const saveName = async () => {
    const trimmed = draftName.trim()
    if (!trimmed) return
    await updateProfile.mutateAsync(trimmed)
    setEditingName(false)
  }

  const startAction = () => {
    if (isFixedSet) {
      const set = findSetByScope(scope)
      if (set) onStartSet(set)
    } else if (scope.startsWith('part:')) {
      onStartPart(scope.slice('part:'.length) as Part)
    } else {
      onStartPart(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Signed-in identity strip */}
      <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Avatar name={displayName} picture={picture} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <Eyebrow>Twój profil w rankingu</Eyebrow>
              <span style={{ font: sans(15, 600), color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setDraftName(displayName)
                setEditingName((v) => !v)
              }}
            >
              {editingName ? 'Anuluj' : 'Zmień nazwę'}
            </Button>
            <Button size="sm" variant="text" onClick={onLogout}>
              Wyloguj
            </Button>
          </div>
        </div>
        {editingName && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void saveName()
            }}
            style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              maxLength={40}
              placeholder="Twoja nazwa w rankingu"
              autoFocus
              style={{
                flex: '1 1 180px',
                height: 38,
                padding: '0 12px',
                borderRadius: 9,
                border: '1px solid var(--rule)',
                background: 'var(--bg)',
                color: 'var(--text)',
                font: sans(14),
              }}
            />
            <Button size="sm" variant="dark" type="submit" disabled={updateProfile.isPending || !draftName.trim()}>
              {updateProfile.isPending ? 'Zapisuję…' : 'Zapisz'}
            </Button>
          </form>
        )}
      </div>

      {/* Scope selectors */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Eyebrow>Całość i części sagi</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Chip active={scope === 'all'} onClick={() => onScopeChange('all')}>
              Cały bank{counts.all ? ` · ${counts.all}` : ''}
            </Chip>
            {PARTS.map((p) => {
              const s = `part:${p}`
              return (
                <Chip key={p} active={scope === s} onClick={() => onScopeChange(s)}>
                  {PART_LABEL[p]}{counts[s] ? ` · ${counts[s]}` : ''}
                </Chip>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Eyebrow>Zestawy egzaminacyjne</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {visibleSets.map((set) => (
              <Chip key={set.slug} active={scope === set.scope} onClick={() => onScopeChange(set.scope)}>
                {set.title}{counts[set.scope] ? ` · ${counts[set.scope]}` : ''}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {/* Mode toggle for whole suite & parts */}
      {!isFixedSet && (
        <Segmented<BoardMode>
          items={[
            { key: 'runs', label: 'Najlepszy quiz' },
            { key: 'mastery', label: 'Opanowanie banku' },
          ]}
          value={activeMode}
          onChange={setMode}
        />
      )}

      {/* Board */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionHead
          title={scopeLabel(scope)}
          meta={activeMode === 'runs' ? 'najlepszy wynik · czas' : `${scopeTotalQuestions} pytań w puli`}
        />

        {isLoading && <div style={{ font: sans(14), color: 'var(--text-3)', padding: '16px 0' }}>Ładowanie rankingu…</div>}

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0' }}>
            <span style={{ font: sans(14), color: 'var(--accent-text)' }}>Nie udało się pobrać rankingu.</span>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>Spróbuj ponownie</Button>
          </div>
        )}

        {!isLoading && !error && data && activeMode === 'runs' && (
          data.runs.length === 0 ? (
            <EmptyBoard
              message={
                isFixedSet
                  ? 'Nikt jeszcze nie ukończył tego zestawu.'
                  : 'Nikt jeszcze nie ukończył quizu w tym zakresie (z domyślnymi filtrami).'
              }
              cta={isFixedSet ? 'Zagraj ten zestaw' : 'Rozpocznij quiz'}
              onAction={startAction}
            />
          ) : (
            <div>
              {data.runs.map((row) => (
                <RunRow key={row.playerId} row={row} />
              ))}
              <div style={{ paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ font: sans(13), color: 'var(--text-3)' }}>
                  {isFixedSet
                    ? 'Remis rozstrzyga krótszy czas odpowiedzi.'
                    : 'Liczy się najwyższy %, potem liczba poprawnych odpowiedzi i tempo.'}
                </span>
                <Button size="sm" variant="dark" onClick={startAction}>
                  {isFixedSet ? 'Zagraj ten zestaw' : 'Popraw wynik'}
                </Button>
              </div>
            </div>
          )
        )}

        {!isLoading && !error && data && activeMode === 'mastery' && (
          data.mastery.length === 0 ? (
            <EmptyBoard
              message="Brak zsynchronizowanych odpowiedzi w tym zakresie. Odpowiedz na kilka pytań w quizie lub fiszkach."
              cta="Zacznij quiz"
              onAction={startAction}
            />
          ) : (
            <div>
              {data.mastery.map((row) => (
                <MasteryRow key={row.playerId} row={row} totalQuestions={scopeTotalQuestions} />
              ))}
              <p style={{ margin: '12px 0 0', font: sans(13), color: 'var(--text-3)' }}>
                Opanowane = 3 poprawne odpowiedzi z rzędu. Przy remisie decyduje postęp w nauce i ogólna trafność.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  )
}

function RunRow({ row }: { row: ZmierzchRunLeader }) {
  return (
    <div
      style={{
        padding: '12px 10px',
        margin: '0 -10px',
        borderRadius: 10,
        borderBottom: '1px solid var(--border)',
        background: row.isMe ? 'var(--accent-soft)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <RankBadge rank={row.rank} />
        <Avatar name={row.name} picture={row.picture} size={30} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ font: sans(15, row.isMe ? 600 : 500), color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.name}
            {row.isMe && <span style={{ font: mono(11, 600), color: 'var(--accent-text)', marginLeft: 6 }}>TY</span>}
          </span>
          <span style={{ font: mono(12), color: 'var(--text-3)' }}>
            {formatDurationMs(row.durationMs)} · {row.attempts} {row.attempts === 1 ? 'próba' : row.attempts < 5 ? 'próby' : 'prób'}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
        <span style={{ font: mono(18, 600), color: 'var(--text)' }}>{row.correct}/{row.total}</span>
        <span style={{ font: mono(12), color: 'var(--text-2)', minWidth: 34, textAlign: 'right' }}>{row.pct}%</span>
      </div>
    </div>
  )
}

function MasteryRow({ row, totalQuestions }: { row: ZmierzchMasteryLeader; totalQuestions: number }) {
  const knownPct = totalQuestions ? Math.min(100, (row.known / totalQuestions) * 100) : 0
  const learningPct = totalQuestions ? Math.min(100 - knownPct, (row.learning / totalQuestions) * 100) : 0
  return (
    <div
      style={{
        padding: '12px 10px',
        margin: '0 -10px',
        borderRadius: 10,
        borderBottom: '1px solid var(--border)',
        background: row.isMe ? 'var(--accent-soft)' : 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <RankBadge rank={row.rank} />
          <Avatar name={row.name} picture={row.picture} size={30} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ font: sans(15, row.isMe ? 600 : 500), color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.name}
              {row.isMe && <span style={{ font: mono(11, 600), color: 'var(--accent-text)', marginLeft: 6 }}>TY</span>}
            </span>
            <span style={{ font: mono(12), color: 'var(--text-3)' }}>
              przerobione {row.seen}/{totalQuestions} · trafność {row.accuracy}%
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ font: mono(17, 600), color: 'var(--text)' }}>{row.known}/{totalQuestions}</div>
          <div style={{ font: mono(11), color: 'var(--text-3)' }}>opanowane</div>
        </div>
      </div>
      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--seg-bg)', marginLeft: 34 }}>
        <div style={{ width: `${knownPct}%`, background: 'var(--sage)' }} />
        <div style={{ width: `${learningPct}%`, background: 'var(--gold)' }} />
      </div>
    </div>
  )
}

function EmptyBoard({ message, cta, onAction }: { message: string; cta: string; onAction: () => void }) {
  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
      <p style={{ margin: 0, font: sans(14), color: 'var(--text-2)' }}>{message}</p>
      <Button size="sm" variant="dark" onClick={onAction}>{cta}</Button>
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  const top = rank <= 3
  return (
    <span
      style={{
        width: 24,
        textAlign: 'center',
        font: mono(top ? 15 : 13, top ? 700 : 500),
        color: rank === 1 ? 'var(--accent-text)' : top ? 'var(--text)' : 'var(--text-3)',
        flexShrink: 0,
      }}
    >
      {rank}
    </span>
  )
}

export function Avatar({ name, picture, size = 34 }: { name: string; picture: string | null; size?: number }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase()
  if (picture) {
    return (
      <img
        src={picture}
        alt=""
        referrerPolicy="no-referrer"
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }}
      />
    )
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--ink)',
        color: 'var(--on-ink)',
        font: mono(Math.round(size * 0.42), 600),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {initial}
    </span>
  )
}
