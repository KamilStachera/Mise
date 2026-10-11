import { useNewVersion } from '../lib/useNewVersion'

/**
 * "New version" prompt, top-center, stays until tapped. Not an automatic reload:
 * that would throw away a half-filled recipe form or an open cook mode.
 */
export function UpdatePill() {
  if (!useNewVersion()) return null

  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      style={{
        position: 'fixed',
        top: 'calc(12px + env(safe-area-inset-top))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 16px',
        borderRadius: 999,
        border: 0,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        background: 'var(--text)',
        color: 'var(--bg)',
        font: '500 13.5px var(--sans)',
        boxShadow: '0 6px 24px rgba(0,0,0,.25)',
      }}
    >
      Nowa wersja Pichci
      <span style={{ fontWeight: 600, color: 'var(--accent-soft)' }}>Odśwież ↻</span>
    </button>
  )
}
