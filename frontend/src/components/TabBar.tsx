import { useLocation, useNavigate } from 'react-router-dom'
import { navSection, useToBuyCount } from './Sidebar'
import { mono, sans } from './ui'

/** Height of the bar above the safe area — App pads <main> by this much. */
export const TAB_BAR_HEIGHT = 47

/**
 * Phone navigation: five text tabs. Losuj lives inside Przepisy, Historia
 * and the profile inside "Ja".
 */
export function TabBar() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const toBuy = useToBuyCount()
  const section = navSection(pathname)

  const tabs: { key: string; label: string; to: string; active: boolean; badge?: number }[] = [
    { key: 'recipes', label: 'Przepisy', to: '/', active: section === 'recipes' || section === 'random' },
    { key: 'plan', label: 'Plan', to: '/plan', active: section === 'plan' },
    { key: 'shopping', label: 'Zakupy', to: '/shopping', active: section === 'shopping', badge: toBuy },
    { key: 'pantry', label: 'Spiżarnia', to: '/pantry', active: section === 'pantry' },
    { key: 'me', label: 'Ja', to: '/profile', active: section === 'profile' || section === 'history' },
  ]

  return (
    <nav
      style={{
        // Fixed, not a flex child: in the installed (standalone) PWA the root
        // scroller can still pan on top-overscroll, which would carry a
        // static bar off-screen. App.tsx pads <main> to keep content clear.
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        borderTop: '1px solid var(--rule)',
        background: 'var(--bg)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => nav(t.to)}
          style={{
            height: TAB_BAR_HEIGHT - 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            border: 0,
            // Active marker as a 3px background strip: an inset box-shadow on these
            // fractional-width cells (e.g. 412/5 px) leaves grey slivers at the edges.
            background: t.active ? 'linear-gradient(var(--accent), var(--accent)) top / 100% 3px no-repeat' : 'transparent',
            cursor: 'pointer',
            font: sans(12.5, 600),
            color: t.active ? 'var(--text)' : 'var(--text-3)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {t.label}
          {!!t.badge && <span style={{ font: mono(10, 600), color: 'var(--accent-text)' }}>{t.badge}</span>}
        </button>
      ))}
    </nav>
  )
}
