import { loginUrl } from '../api/client'
import { Button, Eyebrow, SectionHead, mono, sans } from '../components/ui'
import { formatDurationMs, type ZmierzchPersonalBest } from './api'
import { QUIZ_SETS, type QuizSet } from './sets'

export function SetsView({
  isLoggedIn,
  personalBests,
  scopeCounts,
  onStartSet,
  onOpenLeaderboard,
}: {
  isLoggedIn: boolean
  personalBests: Record<string, ZmierzchPersonalBest>
  scopeCounts: Record<string, number>
  onStartSet: (set: QuizSet) => void
  onOpenLeaderboard: (scope: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <p style={{ margin: 0, font: sans(15), lineHeight: 1.5, color: 'var(--text-2)' }}>
        Stałe zestawy pytań — każdy dostaje ten sam komplet i ten sam limit czasu (20 s na pytanie), więc wyniki można sprawiedliwie porównać w rankingu.
      </p>

      {!isLoggedIn && (
        <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ font: sans(14), color: 'var(--text-2)' }}>
            Możesz grać bez logowania, ale zalogowanie przez Google zapisze Twoje rekordy na tablicy wyników.
          </span>
          <a href={loginUrl('/zmierzch')} style={{ textDecoration: 'none' }}>
            <Button size="sm" variant="dark" type="button">Zaloguj przez Google</Button>
          </a>
        </div>
      )}

      <div>
        <SectionHead title="Zestawy egzaminacyjne" meta={`${QUIZ_SETS.length} zestawów`} />
        {QUIZ_SETS.map((set) => {
          const best = personalBests[set.scope]
          const players = scopeCounts[set.scope] ?? 0
          return (
            <div
              key={set.slug}
              style={{
                padding: '16px 0',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 21, color: 'var(--title)' }}>
                  {set.title}
                </span>
                <Eyebrow>
                  {set.questionIds.length} pytań · {set.seconds} s · {set.difficultyLabel}
                </Eyebrow>
              </div>
              <p style={{ margin: 0, font: sans(14), lineHeight: 1.45, color: 'var(--text-2)' }}>
                {set.subtitle}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ font: mono(12), color: best ? 'var(--sage-text)' : 'var(--text-3)' }}>
                  {best
                    ? `Twój rekord: ${best.correct}/${best.total} (${best.pct}%) · ${formatDurationMs(best.durationMs)} · ${best.attempts} ${attemptsWord(best.attempts)}`
                    : players > 0
                      ? `W rankingu: ${players} ${playersWord(players)}`
                      : 'Jeszcze bez wyników w rankingu'}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {isLoggedIn && (
                    <Button size="sm" variant="quiet" onClick={() => onOpenLeaderboard(set.scope)}>
                      Ranking{players > 0 ? ` (${players})` : ''}
                    </Button>
                  )}
                  <Button size="sm" variant="dark" onClick={() => onStartSet(set)}>
                    Start
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function attemptsWord(n: number) {
  if (n === 1) return 'próba'
  const d = n % 10
  const t = n % 100
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? 'próby' : 'prób'
}

function playersWord(n: number) {
  return n === 1 ? 'gracz' : 'graczy'
}
