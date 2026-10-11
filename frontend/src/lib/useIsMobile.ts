import { useEffect, useState } from 'react'

const QUERY = '(max-width: 700px)'

/** Phone-width viewport — Sidebar becomes a bottom tab bar (TabBar), pages tighten padding. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}
