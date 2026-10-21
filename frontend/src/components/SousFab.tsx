import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { TAB_BAR_HEIGHT } from './TabBar'

/** Gap between the button and whatever it floats above. */
const GAP = 12

/**
 * Phones: a round ✦ in the bottom-right corner that opens Sous from any page (desktop has the
 * sidebar button). It floats above the tab bar, or above a page's pinned action bar — those
 * carry `data-pinned-bar`, and their height is measured since pages differ (Losuj stacks two).
 */
export function SousFab({ onOpen }: { onOpen: () => void }) {
  const { pathname } = useLocation()
  const [barHeight, setBarHeight] = useState(0)

  useEffect(() => {
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const bar = document.querySelector('[data-pinned-bar]')
        setBarHeight(bar ? Math.round(bar.getBoundingClientRect().height) : 0)
      })
    }
    measure()
    // Bars come and go with page state (loaded data, open review), not only with the route.
    const observer = new MutationObserver(measure)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [pathname])

  return (
    <button
      type="button"
      aria-label="Zapytaj Sous"
      onClick={onOpen}
      style={{
        position: 'fixed',
        right: 16,
        bottom: `calc(${TAB_BAR_HEIGHT + barHeight + GAP}px + env(safe-area-inset-bottom))`,
        // Over pinned bars (20), under the tab bar's layer (30) — sheets and cook mode cover it.
        zIndex: 25,
        width: 52,
        height: 52,
        borderRadius: '50%',
        border: 0,
        background: 'var(--panel-bg)',
        color: 'var(--accent-warm)',
        fontSize: 22,
        lineHeight: 1,
        cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(0,0,0,.25)',
        transition: 'bottom .18s ease',
      }}
    >
      ✦
    </button>
  )
}
