import { Link } from 'react-router-dom'
import { Eyebrow, sans } from '../components/ui'

/** Hidden automatically once the quiz night is over. */
const SHOW_UNTIL = new Date(2026, 10, 29)

/** Entry point to /zmierzch on the library and the pre-login screens. Temporary, like the module. */
export function ZmierzchLink() {
  if (Date.now() >= SHOW_UNTIL.getTime()) return null
  return (
    <Link
      to="/zmierzch"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: '12px 16px',
        borderRadius: 12,
        background: 'var(--text)',
        color: 'var(--bg)',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <Eyebrow tone="light">POP Quiz · Mova · 28.11</Eyebrow>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 21, lineHeight: 1.15 }}>
          Zmierzch<span style={{ fontStyle: 'italic', color: 'var(--accent-warm)' }}>.</span> Trening do quizu
        </span>
      </span>
      <span style={{ font: sans(20, 500), flexShrink: 0 }}>→</span>
    </Link>
  )
}
