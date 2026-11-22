// Where Sous lives on phones (2026-11 redesign): never a floating button over content.
//  - Pages with a pinned action bar put it there, as a square at the end of the bar (PinnedBar).
//  - Every other page gets a small ✦ next to its title (SousTitleButton, rendered by PageTitle).
//  - Focus flows (admin, questionnaires, the recipe editor, the live session) get neither.
// Desktop keeps the sidebar button, so all of this renders nothing there.
import { useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth, useChatHealth } from '../api/hooks'
import { requestChat } from '../lib/chatBus'
import { TAB_BAR_HEIGHT } from '../lib/layout'
import { useIsMobile } from '../lib/useIsMobile'

/** Routes where Sous stays out of the way: step-by-step forms, admin and the workout tracker. */
export function sousHiddenOn(pathname: string): boolean {
  return (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/profile/ankieta') ||
    pathname.startsWith('/trening/ankieta') ||
    pathname.startsWith('/trening/sesja/') ||
    pathname.startsWith('/add') ||
    /^\/recipe\/[^/]+\/edit/.test(pathname)
  )
}

/** Phone + signed in + Sous switched on for the household + not a focus flow. */
export function useSousOnPhone(): boolean {
  const isMobile = useIsMobile()
  const { canEdit } = useAuth()
  const { data: chatHealth } = useChatHealth()
  const { pathname } = useLocation()
  return isMobile && canEdit && !!chatHealth?.enabled && !sousHiddenOn(pathname)
}

// How many mounted pinned bars carry the square — while one does, titles drop their ✦.
let barsWithSous = 0
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = () => listeners.forEach((fn) => fn())

function useRegisterBar(active: boolean) {
  useEffect(() => {
    if (!active) return
    barsWithSous++
    emit()
    return () => {
      barsWithSous--
      emit()
    }
  }, [active])
}

const sousFace: CSSProperties = {
  border: 0,
  background: 'var(--panel-bg)',
  color: 'var(--accent-warm)',
  lineHeight: 1,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  WebkitTapHighlightColor: 'transparent',
}

/** 46 × 46 ✦ for the end of an action bar (pinned bars, the recipe footer). */
export function SousSquare({ size = 46, prompt }: { size?: number; prompt?: string }) {
  return (
    <button
      type="button"
      aria-label="Zapytaj Sous"
      title="Zapytaj Sous"
      onClick={() => requestChat(prompt)}
      style={{ ...sousFace, width: size, height: size, borderRadius: 12, fontSize: 20 }}
    >
      ✦
    </button>
  )
}

/** The quiet ✦ beside a phone page title — only when no pinned bar on the page already has one. */
export function SousTitleButton() {
  const on = useSousOnPhone()
  const bars = useSyncExternalStore(subscribe, () => barsWithSous)
  if (!on || bars > 0) return null
  return (
    <button
      type="button"
      aria-label="Zapytaj Sous"
      title="Zapytaj Sous"
      onClick={() => requestChat()}
      style={{ ...sousFace, width: 40, height: 40, borderRadius: 10, fontSize: 17 }}
    >
      ✦
    </button>
  )
}

/**
 * The phone action bar pinned above the tab bar (or the screen edge with `overTabBar={false}`).
 * Children share the row; Sous takes a square at the end unless `sous={false}`. A rule on top
 * keeps scrolled content from looking sliced. Pages keep ~150 px of bottom padding so the last
 * row clears it.
 */
export function PinnedBar({ children, sous = true, overTabBar = true, below, style }: {
  children: ReactNode
  sous?: boolean
  overTabBar?: boolean
  /** A line under the row (Losuj's pool size). */
  below?: ReactNode
  style?: CSSProperties
}) {
  const sousOn = useSousOnPhone() && sous
  useRegisterBar(sousOn)
  return (
    <div
      data-pinned-bar
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: overTabBar ? `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))` : 0,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: overTabBar ? '12px 16px 10px' : '10px 16px calc(10px + env(safe-area-inset-bottom))',
        background: 'var(--bg)',
        boxShadow: '0 -1px 0 var(--border)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 10 }}>{children}</div>
        {sousOn && <SousSquare size={54} />}
      </div>
      {below}
    </div>
  )
}
