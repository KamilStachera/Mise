import { useEffect, useRef, useState } from 'react'
import { registerToastConsumer } from '../lib/toastBus'
import { useIsMobile } from '../lib/useIsMobile'

/** Single global toast, bottom-center, auto-dismissing. Mounted once in App. */
export function ToastHost() {
  const isMobile = useIsMobile()
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const unregister = registerToastConsumer((msg) => {
      setMessage(msg)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setMessage(null), 4500)
    })
    return () => {
      unregister()
      clearTimeout(timer.current)
    }
  }, [])

  if (!message) return null

  return (
    <div
      role="status"
      onClick={() => setMessage(null)}
      style={{
        position: 'fixed',
        // Phones: clear the tab bar plus a pinned action/add bar above it.
        bottom: isMobile ? 'calc(132px + env(safe-area-inset-bottom))' : 32,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        maxWidth: 'min(92vw, 440px)',
        padding: '11px 18px',
        borderRadius: 12,
        background: 'var(--text)',
        color: 'var(--bg)',
        font: "500 13.5px var(--sans)",
        boxShadow: '0 6px 24px rgba(0,0,0,.25)',
        cursor: 'pointer',
      }}
    >
      {message}
    </div>
  )
}
