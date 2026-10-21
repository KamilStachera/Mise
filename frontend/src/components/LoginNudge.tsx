import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { loginUrl } from '../api/client'
import { useAuth } from '../api/hooks'
import { useIsMobile } from '../lib/useIsMobile'
import { TAB_BAR_HEIGHT } from './TabBar'
import { sans } from './ui'

/**
 * Floating red „!” while signed out, so we notice the read-only mode. Hover (or a first tap on
 * a phone) opens the note; a click on the open note goes to Google sign-in.
 */
export function LoginNudge() {
  const { data, canEdit } = useAuth()
  const { pathname } = useLocation()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  if (!data || canEdit) return null

  // Phones: above the tab bar, or above the recipe page's own action bar.
  const bottom = !isMobile ? '20px' : pathname.startsWith('/recipe/')
    ? 'calc(92px + env(safe-area-inset-bottom))'
    : `calc(${TAB_BAR_HEIGHT + 14}px + env(safe-area-inset-bottom))`

  return (
    <button
      type="button"
      aria-label="Tylko podgląd — zaloguj się, żeby mieć dostęp do wszystkich funkcji"
      // Mouse only: touch emulates hover right before the click, which would skip the note.
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true) }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false) }}
      onBlur={() => setOpen(false)}
      onClick={() => {
        if (open) window.location.href = loginUrl(pathname)
        else setOpen(true)
      }}
      style={{
        position: 'fixed',
        right: isMobile ? 16 : 20,
        bottom,
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 36,
        width: open ? undefined : 36,
        maxWidth: 'calc(100vw - 32px)',
        padding: open ? '6px 16px 6px 6px' : 0,
        justifyContent: open ? 'flex-start' : 'center',
        textAlign: 'left',
        borderRadius: open ? 18 : 999,
        border: 0,
        background: 'var(--accent)',
        color: '#fff',
        cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(0,0,0,.22)',
      }}
    >
      <span
        aria-hidden
        style={{ width: 24, height: 24, flex: '0 0 24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', font: sans(16, 700), background: open ? 'rgba(255,255,255,.2)' : 'transparent' }}
      >
        !
      </span>
      {open && (
        <span style={{ font: sans(13.5, 500), lineHeight: 1.35, whiteSpace: isMobile ? 'normal' : 'nowrap' }}>
          Tylko podgląd — <span style={{ fontWeight: 700, textDecoration: 'underline' }}>zaloguj się</span>, żeby mieć dostęp do wszystkich funkcji
        </span>
      )}
    </button>
  )
}
