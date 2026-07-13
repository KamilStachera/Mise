import type { CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useLogout, useShopping } from '../api/hooks'
import { loginUrl } from '../api/client'
import { RecipesIcon, DiceIcon, HistoryIcon, PlanIcon, PantryIcon, ShopIcon, ProfileIcon, ChatIcon, LoginIcon, LogoutIcon } from './icons'

function navStyle(active: boolean, mobile = false): CSSProperties {
  return {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: mobile ? 3 : 5,
    padding: mobile ? '8px 2px' : '11px 6px',
    borderRadius: 14,
    cursor: 'pointer',
    border: 'none',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent-deep)' : 'var(--text-2)',
    width: mobile ? undefined : 58,
    flex: mobile ? 1 : undefined,
    minWidth: 0,
    transition: 'all .15s',
    font: "500 10.5px 'Hanken Grotesk', sans-serif",
    letterSpacing: '.02em',
  }
}

export function NavRail({ chatOpen, onToggleChat, mobile = false }: {
  chatOpen: boolean
  onToggleChat: () => void
  mobile?: boolean
}) {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const { data: shopping } = useShopping()
  const { data: auth, canEdit } = useAuth()
  const logout = useLogout()

  const isLibrary = pathname === '/' || pathname.startsWith('/recipe') || pathname.startsWith('/add')
  const isRandom = pathname.startsWith('/random')
  const isHistory = pathname.startsWith('/history')
  const isPlan = pathname.startsWith('/plan')
  const isPantry = pathname.startsWith('/pantry')
  const isShopping = pathname.startsWith('/shopping')
  const isProfile = pathname.startsWith('/profile')

  const toBuy = shopping ? shopping.total - shopping.checkedCount : 0

  const badge = toBuy > 0 && (
    <span
      style={{
        position: 'absolute',
        top: mobile ? 3 : 7,
        right: mobile ? 'calc(50% - 22px)' : 11,
        minWidth: 16,
        height: 16,
        padding: '0 4px',
        borderRadius: 8,
        background: 'var(--accent)',
        color: '#fff',
        fontSize: 9.5,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {toBuy}
    </span>
  )

  // Phone: bottom tab bar (the chat panel is desktop-only).
  if (mobile) {
    return (
      <nav
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'stretch',
          gap: 2,
          padding: '5px 6px calc(5px + env(safe-area-inset-bottom))',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <button onClick={() => nav('/')} style={navStyle(isLibrary, true)}>
          <RecipesIcon />
          <span>Przepisy</span>
        </button>
        <button onClick={() => nav('/random')} style={navStyle(isRandom, true)}>
          <DiceIcon />
          <span>Losuj</span>
        </button>
        <button onClick={() => nav('/plan')} style={navStyle(isPlan, true)}>
          <PlanIcon />
          <span>Plan</span>
        </button>
        <button onClick={() => nav('/pantry')} style={navStyle(isPantry, true)}>
          <PantryIcon />
          <span>Spiżarnia</span>
        </button>
        <button onClick={() => nav('/shopping')} style={navStyle(isShopping, true)}>
          <ShopIcon />
          <span>Zakupy</span>
          {badge}
        </button>
        <button onClick={() => nav('/profile')} style={navStyle(isProfile || isHistory, true)}>
          <ProfileIcon />
          <span>Profil</span>
        </button>
      </nav>
    )
  }

  return (
    <nav
      style={{
        width: 78,
        flex: '0 0 78px',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '18px 0 16px',
        gap: 4,
      }}
    >
      <div
        onClick={() => nav('/')}
        style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 14 }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(160,66,32,.3)',
          }}
        >
          <span style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 21, color: '#fff', lineHeight: 1, marginTop: -1 }}>
            m
          </span>
        </div>
      </div>

      <button onClick={() => nav('/')} style={navStyle(isLibrary)}>
        <RecipesIcon />
        <span>Przepisy</span>
      </button>
      <button onClick={() => nav('/random')} style={navStyle(isRandom)}>
        <DiceIcon />
        <span>Losuj</span>
      </button>
      <button onClick={() => nav('/history')} style={navStyle(isHistory)}>
        <HistoryIcon />
        <span>Historia</span>
      </button>
      <button onClick={() => nav('/plan')} style={navStyle(isPlan)}>
        <PlanIcon />
        <span>Plan</span>
      </button>
      <button onClick={() => nav('/pantry')} style={navStyle(isPantry)}>
        <PantryIcon />
        <span>Spiżarnia</span>
      </button>
      <button onClick={() => nav('/shopping')} style={navStyle(isShopping)}>
        <ShopIcon />
        <span>Zakupy</span>
        {badge}
      </button>
      <button onClick={() => nav('/profile')} style={navStyle(isProfile)}>
        <ProfileIcon />
        <span>Profil</span>
      </button>

      <div style={{ flex: 1 }} />

      {canEdit && (
        <button
          onClick={onToggleChat}
          style={{
            ...navStyle(false),
            color: chatOpen ? 'var(--accent-deep)' : 'var(--text-2)',
            background: chatOpen ? 'var(--accent-soft)' : 'transparent',
          }}
        >
          <ChatIcon />
          <span>Czat</span>
        </button>
      )}

      {canEdit ? (
        <button onClick={() => logout.mutate()} title={auth?.email ?? undefined} style={navStyle(false)}>
          {auth?.picture ? (
            <img
              src={auth.picture}
              alt=""
              referrerPolicy="no-referrer"
              style={{ width: 21, height: 21, borderRadius: '50%' }}
            />
          ) : (
            <LogoutIcon />
          )}
          <span>Wyloguj</span>
        </button>
      ) : (
        <button
          onClick={() => { window.location.href = loginUrl(pathname) }}
          title="Zaloguj się przez Google"
          style={navStyle(false)}
        >
          <LoginIcon />
          <span>Zaloguj</span>
        </button>
      )}
    </nav>
  )
}
