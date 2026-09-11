import { useIsMobile } from '../lib/useIsMobile'
import { usePalabras } from '../palabras/usePalabras'
import type { View } from '../palabras/types'
import { HomeView } from '../palabras/views/HomeView'
import { PracticeView } from '../palabras/views/PracticeView'
import { SoundsView } from '../palabras/views/SoundsView'
import { AddView } from '../palabras/views/AddView'
import { StatsView } from '../palabras/views/StatsView'
import '../palabras/palabras.css'

const TABS: { view: View; label: string }[] = [
  { view: 'home', label: 'Talia' },
  { view: 'practice', label: 'Nauka' },
  { view: 'sounds', label: 'Dźwięki' },
  { view: 'add', label: 'Dodaj' },
  { view: 'stats', label: 'Postęp' },
]

/**
 * Spanish flashcards (SRS) — a self-contained module under `src/palabras/`, ported
 * from the standalone Palabras app. It has no backend: progress and custom words
 * live in this browser's localStorage, so they don't follow the user across devices.
 * The tab is reducer state, not a route: "Nauka" starts a session on entry.
 */
export function Palabras() {
  const isMobile = useIsMobile()
  const p = usePalabras()
  const { state } = p

  return (
    <div className="palabras" style={{ maxWidth: 720, margin: '0 auto', padding: isMobile ? '22px 14px 28px' : '38px 42px 60px' }}>
      <div style={{ font: "600 11px 'Hanken Grotesk'", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 7 }}>
        Hiszpański · ES · PL
      </div>
      <h1 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: isMobile ? 30 : 38, lineHeight: 1.05, margin: '0 0 16px', color: 'var(--text)' }}>
        Palabras
      </h1>

      <nav className="tabs" style={{ marginBottom: 22 }}>
        {TABS.map(({ view, label }) => (
          <button
            key={view}
            type="button"
            className={state.view === view ? 'tab is-active' : 'tab'}
            aria-current={state.view === view ? 'page' : undefined}
            onClick={() => p.go(view)}
          >
            {label}
          </button>
        ))}
      </nav>

      {state.view === 'home' && (
        <HomeView
          counts={p.counts}
          allWords={p.allWords}
          srs={state.srs}
          deckId={state.deckId}
          onPickDeck={p.pickDeck}
          onStartSession={p.startSession}
          onGoAdd={() => p.go('add')}
        />
      )}

      {state.view === 'practice' && (
        <PracticeView
          session={state.session}
          srs={state.srs}
          onReveal={p.reveal}
          onGrade={p.grade}
          onStartSession={p.startSession}
          onGoHome={() => p.go('home')}
        />
      )}

      {state.view === 'sounds' && <SoundsView hideResp={state.hideResp} onToggleResp={p.toggleResp} />}

      {state.view === 'add' && (
        <AddView
          form={state.form}
          saveMsg={state.saveMsg}
          saveError={state.saveError}
          custom={state.custom}
          onSetField={p.setField}
          onSave={p.addWord}
          onRemove={p.removeWord}
        />
      )}

      {state.view === 'stats' && (
        <StatsView
          counts={p.counts}
          allWords={p.allWords}
          srs={state.srs}
          confirmReset={state.confirmReset}
          onReset={p.resetProgress}
        />
      )}
    </div>
  )
}
