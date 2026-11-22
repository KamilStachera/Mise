import { useLocation, useNavigate } from 'react-router-dom'
import { navSection, useToBuyCount } from './Sidebar'
import { TAB_BAR_HEIGHT } from '../lib/layout'
import { mono, sans } from './ui'

export { TAB_BAR_HEIGHT }

/**
 * Phone navigation: five text tabs. Losuj lives inside Przepisy, Spiżarnia inside Zakupy
 * (the section strip switches Jedzenie · Dom · Spiżarnia), Historia gotowania and the profile inside "Ja".
 */
export function TabBar() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const toBuy = useToBuyCount()
  const section = navSection(pathname)

  const tabs: { key: string; label: string; to: string; active: boolean; badge?: number }[] = [
    { key: 'recipes', label: 'Przepisy', to: '/', active: section === 'recipes' || section === 'random' },
    { key: 'plan', label: 'Plan', to: '/plan', active: section === 'plan' },
    { key: 'training', label: 'Trening', to: '/trening', active: section === 'training' },
    { key: 'shopping', label: 'Zakupy', to: '/shopping', active: section === 'shopping' || section === 'pantry', badge: toBuy },
    { key: 'me', label: 'Ja', to: '/profile', active: section === 'profile' || section === 'history' || section === 'admin' },
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
        gridTemplateColumns: `repeat(${tabs.length}, 1fr)`,
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
            font: sans(13, 600),
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
