import { useEffect, useRef, useState } from 'react'
import { registerToastConsumer, type ToastAction } from '../lib/toastBus'
import { useIsMobile } from '../lib/useIsMobile'

/** Single global toast, bottom-center, auto-dismissing. Mounted once in App. */
export function ToastHost() {
  const isMobile = useIsMobile()
  const [toast, setToast] = useState<{ message: string; action?: ToastAction } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const unregister = registerToastConsumer((t) => {
      setToast(t)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setToast(null), t.action ? 6000 : 4500)
    })
    return () => {
      unregister()
      clearTimeout(timer.current)
    }
  }, [])

  if (!toast) return null

  return (
    <div
      role="status"
      onClick={() => setToast(null)}
      style={{
        position: 'fixed',
        // Phones: clear the tab bar plus a pinned action/add bar above it.
        bottom: isMobile ? 'calc(132px + env(safe-area-inset-bottom))' : 32,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        maxWidth: 'min(92vw, 440px)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '11px 18px',
        borderRadius: 12,
        background: 'var(--text)',
        color: 'var(--bg)',
        font: "500 13.5px var(--sans)",
        boxShadow: '0 6px 24px rgba(0,0,0,.25)',
        cursor: 'pointer',
      }}
    >
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            toast.action!.run()
            setToast(null)
          }}
          style={{ border: 0, background: 'transparent', padding: 0, color: 'var(--accent-warm)', font: "600 13.5px var(--sans)", cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
