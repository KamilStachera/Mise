import type { CSSProperties, ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useChatHealth, useLogout, useShopping, useSupplies } from '../api/hooks'
import { loginUrl } from '../api/client'
import { PLAN_PAGES, TRAINING_PAGES } from '../lib/navModel'
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
  if (pathname.startsWith('/trening')) return 'training'
  if (pathname.startsWith('/admin')) return 'admin'
  return 'recipes'
}

/** `open` = ink label without the accent bar — a parent whose sub-link carries the bar. */
function NavLink({ active, open, onClick, children }: { active: boolean; open?: boolean; onClick: () => void; children: ReactNode }) {
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
    color: active ? 'var(--nav-active-text)' : open ? 'var(--text)' : 'var(--text-3)',
    boxShadow: active ? 'inset 3px 0 0 var(--nav-active)' : undefined,
    textAlign: 'left',
  }
  return (
    <button type="button" onClick={onClick} style={style}>
      {children}
    </button>
  )
}

/** Indented sub-page (Dzień / Tydzień …) on the 1 px rule; active = 3 px accent. */
function SubLink({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 34,
        padding: '0 0 0 14px',
        marginLeft: -1,
        border: 0,
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        font: sans(14, active ? 600 : 500),
        color: active ? 'var(--nav-active-text)' : 'var(--text-3)',
        boxShadow: active ? 'inset 3px 0 0 var(--nav-active)' : undefined,
      }}
    >
      {children}
    </button>
  )
}

/**
 * Desktop navigation: full page names, less-used pages in their own group, Sous + session pinned at
 * the bottom. Only the current section unfolds its sub-pages — they are the page's view switcher,
 * so pages don't repeat them in their header.
 */
export function Sidebar({ chatOpen, onToggleChat }: { chatOpen: boolean; onToggleChat: () => void }) {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const { data: auth, canEdit } = useAuth()
  const { data: chatHealth } = useChatHealth()
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
        gap: 20,
        borderRight: '1px solid var(--rule)',
        padding: '28px 20px 24px',
        // The links scroll on their own, so Sous and Wyloguj stay on screen in short windows.
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, flex: '1 1 auto', minHeight: 0, overflowY: 'auto', margin: '0 -20px', padding: '0 20px' }}>
        <button type="button" onClick={() => nav('/')} style={{ border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', padding: '0 0 0 12px', color: 'var(--text)' }}>
          <Wordmark />
        </button>
        <nav style={{ display: 'flex', flexDirection: 'column' }}>
          <NavLink active={section === 'recipes'} onClick={() => nav('/')}>Przepisy</NavLink>
          <NavLink active={section === 'random'} onClick={() => nav('/random')}>Losuj</NavLink>
          <NavLink active={section === 'plan' && !canEdit} open={section === 'plan'} onClick={() => nav('/plan')}>Plan</NavLink>
          {canEdit && section === 'plan' && (
            <div style={{ display: 'flex', flexDirection: 'column', margin: '0 0 6px 12px', borderLeft: '1px solid var(--border)' }}>
              {PLAN_PAGES.map((p) => <SubLink key={p.key} active={p.match(pathname)} onClick={() => nav(p.to)}>{p.label}</SubLink>)}
            </div>
          )}
          <NavLink active={section === 'shopping'} onClick={() => nav('/shopping')}>
            Zakupy
            {toBuy > 0 && <span style={{ font: mono(12, 500), color: 'var(--accent-text)' }}>{toBuy}</span>}
          </NavLink>
          <NavLink active={section === 'pantry'} onClick={() => nav('/pantry')}>Spiżarnia</NavLink>
          <NavLink active={section === 'training' && !canEdit} open={section === 'training'} onClick={() => nav('/trening')}>Trening</NavLink>
          {canEdit && section === 'training' && (
            <div style={{ display: 'flex', flexDirection: 'column', margin: '0 0 6px 12px', borderLeft: '1px solid var(--border)' }}>
              {TRAINING_PAGES.map((p) => <SubLink key={p.key} active={p.match(pathname)} onClick={() => nav(p.to)}>{p.label}</SubLink>)}
            </div>
          )}
        </nav>
        <nav style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <span style={{ font: mono(10.5, 500), letterSpacing: '.1em', color: 'var(--text-3)', padding: '0 0 8px 12px' }}>TWOJA KUCHNIA</span>
          <NavLink active={section === 'history'} onClick={() => nav('/history')}>Historia gotowania</NavLink>
          <NavLink active={section === 'profile' && !pathname.startsWith('/profile/cel')} onClick={() => nav('/profile')}>Profil kulinarny</NavLink>
          {canEdit && <NavLink active={pathname.startsWith('/profile/cel')} onClick={() => nav('/profile/cel')}>Twój cel</NavLink>}
          {auth?.isAdmin && <NavLink active={pathname.startsWith('/admin')} onClick={() => nav('/admin')}>Panel admina</NavLink>}
        </nav>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: '0 0 auto', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        {/* Sous is switched on per household (it runs on the owner's ChatGPT plan). */}
        {canEdit && chatHealth?.enabled && (
          <button
            type="button"
            onClick={onToggleChat}
            style={{
              height: 46,
              borderRadius: 12,
              border: chatOpen ? '1px solid var(--rule)' : 0,
              background: chatOpen ? 'transparent' : 'var(--ink)',
              color: chatOpen ? 'var(--text)' : 'var(--on-ink)',
              font: sans(14.5, 600),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
            }}
          >
            <span style={{ color: chatOpen ? 'var(--accent)' : 'var(--on-ink-accent)' }}>✦</span>
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
