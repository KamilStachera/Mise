import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Scroll restoration for the app's own scroll container (<main> scrolls, not the
 * window, so the browser's restoration never kicks in). A new page opens at the
 * top; Back/Forward returns to where that history entry was left — e.g. the
 * recipe list after peeking into a recipe. Query-only changes (?d= on Plan) keep
 * the position.
 */
export function useScrollMemory(ref: RefObject<HTMLElement>) {
  const location = useLocation()
  const navType = useNavigationType()
  const positions = useRef(new Map<string, number>())
  const current = useRef({ key: location.key, pathname: location.pathname })

  // Positions are recorded as you scroll: by the time a route change commits, the
  // new page may already have clamped scrollTop, so reading it on the way out lies.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => positions.current.set(current.current.key, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [ref])

  useLayoutEffect(() => {
    const el = ref.current
    const previous = current.current
    current.current = { key: location.key, pathname: location.pathname }
    if (!el || previous.key === location.key) return

    const saved = navType === 'POP' ? positions.current.get(location.key) : undefined
    if (saved == null) {
      if (previous.pathname !== location.pathname) el.scrollTop = 0
      return
    }
    // The page may still be growing (cached data renders at once, a refetch may not):
    // retry for a moment until it is tall enough, unless the user scrolls first.
    el.scrollTop = saved
    let frames = 0
    let raf = 0
    const retry = () => {
      if (Math.abs(el.scrollTop - saved) < 2 || ++frames > 30 || current.current.key !== location.key) return
      el.scrollTop = saved
      raf = requestAnimationFrame(retry)
    }
    raf = requestAnimationFrame(retry)
    const stop = () => cancelAnimationFrame(raf)
    el.addEventListener('touchstart', stop, { once: true, passive: true })
    el.addEventListener('wheel', stop, { once: true, passive: true })
    return () => {
      stop()
      el.removeEventListener('touchstart', stop)
      el.removeEventListener('wheel', stop)
    }
  }, [ref, location.key, location.pathname, navType])
}
