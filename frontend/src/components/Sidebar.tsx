import type { CSSProperties, ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useLogout, useShopping, useSupplies } from '../api/hooks'
import { loginUrl } from '../api/client'
import { Avatar, Wordmark, mono, sans } from './ui'

/** Everything still to buy across both lists (food + Dom) — the Zakupy badge. */
export function useToBuyCount(): number {
  const { data: shopping } = useShopping()
  const { data: supplies } = useSupplies()
  return (shopping ? shopping.total - shopping.checkedCount : 0) + (supplies ? supplies.total - supplies.checkedCount : 0)
}

/** Which nav entry a path belongs to. Recipe pages, adding and Losuj live under Przepisy on phones. */
export function navSection(pathname: string): string {
  if (pathname.startsWith('/random')) return 'random'
  if (pathname.startsWith('/history')) return 'history'
  if (pathname.startsWith('/plan')) return 'plan'
  if (pathname.startsWith('/pantry')) return 'pantry'
  if (pathname.startsWith('/shopping')) return 'shopping'
  if (pathname.startsWith('/profile')) return 'profile'
  return 'recipes'
}

function NavLink({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  const style: CSSProperties = {
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 8px 0 12px',
    border: 0,
    background: 'transparent',
    cursor: 'pointer',
    font: sans(15, 600),
    color: active ? 'var(--text)' : 'var(--text-3)',
    boxShadow: active ? 'inset 3px 0 0 var(--accent)' : undefined,
    textAlign: 'left',
  }
  return (
    <button type="button" onClick={onClick} style={style}>
      {children}
    </button>
  )
}

/** Desktop navigation: full page names, less-used pages in their own group, Sous + session at the bottom. */
export function Sidebar({ chatOpen, onToggleChat }: { chatOpen: boolean; onToggleChat: () => void }) {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const { data: auth, canEdit } = useAuth()
  const logout = useLogout()
  const toBuy = useToBuyCount()
  const section = navSection(pathname)

  return (
    <aside
      style={{
        width: 220,
        flex: '0 0 220px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 24,
        borderRight: '1px solid var(--rule)',
        padding: '28px 20px 24px',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <button type="button" onClick={() => nav('/')} style={{ border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', padding: '0 0 0 12px', color: 'var(--text)' }}>
          <Wordmark />
        </button>
        <nav style={{ display: 'flex', flexDirection: 'column' }}>
          <NavLink active={section === 'recipes'} onClick={() => nav('/')}>Przepisy</NavLink>
          <NavLink active={section === 'random'} onClick={() => nav('/random')}>Losuj</NavLink>
          <NavLink active={section === 'plan'} onClick={() => nav('/plan')}>Plan</NavLink>
          <NavLink active={section === 'shopping'} onClick={() => nav('/shopping')}>
            Zakupy
            {toBuy > 0 && <span style={{ font: mono(12, 500), color: 'var(--accent-text)' }}>{toBuy}</span>}
          </NavLink>
          <NavLink active={section === 'pantry'} onClick={() => nav('/pantry')}>Spiżarnia</NavLink>
        </nav>
        <nav style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <span style={{ font: mono(10.5, 500), letterSpacing: '.1em', color: 'var(--text-3)', padding: '0 0 8px 12px' }}>TWOJA KUCHNIA</span>
          <NavLink active={section === 'history'} onClick={() => nav('/history')}>Historia</NavLink>
          <NavLink active={section === 'profile'} onClick={() => nav('/profile')}>Profil kulinarny</NavLink>
        </nav>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {canEdit && (
          <button
            type="button"
            onClick={onToggleChat}
            style={{
              height: 46,
              borderRadius: 12,
              border: chatOpen ? '1px solid var(--rule)' : 0,
              background: chatOpen ? 'transparent' : 'var(--text)',
              color: chatOpen ? 'var(--text)' : 'var(--bg)',
              font: sans(14.5, 600),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
            }}
          >
            <span style={{ color: chatOpen ? 'var(--accent)' : 'var(--accent-warm)' }}>✦</span>
            {chatOpen ? 'Sous otwarty' : 'Zapytaj Sous'}
          </button>
        )}
        {canEdit ? (
          <button
            type="button"
            onClick={() => logout.mutate()}
            title={auth?.email ?? undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 0 4px', border: 0, background: 'transparent', cursor: 'pointer', font: sans(13.5), color: 'var(--text-2)' }}
          >
            <Avatar name={auth?.name ?? auth?.email} picture={auth?.picture} />
            Wyloguj
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { window.location.href = loginUrl(pathname) }}
            title="Zaloguj się przez Google"
            style={{ height: 46, borderRadius: 12, border: '1px solid var(--rule)', background: 'transparent', cursor: 'pointer', font: sans(14.5, 600), color: 'var(--text)' }}
          >
            Zaloguj
          </button>
        )}
      </div>
    </aside>
  )
}
