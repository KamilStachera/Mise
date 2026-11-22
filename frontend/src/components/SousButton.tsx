import type { CSSProperties } from 'react'
import { requestChat } from '../lib/chatBus'
import { useRegisterSous, useSousOnPhone } from './Sous'
import { sans } from './ui'

/**
 * Phone Sous launcher placed by the page itself (the screens taken from the Gemini variant):
 * - `header`: a labelled `✦ Sous` button in the PageTitle row (next to the person switch);
 * - `bar`: an espresso square inside a page's own pinned bottom bar.
 * Rendering one counts as „this page has Sous”, so PageTitle's automatic ✦ steps aside.
 * Same visibility rules as the rest of Sous: phones only, signed in, Sous on, not a focus flow.
 */
export function SousButton({ variant = 'header', height, prompt, style }: {
  variant?: 'bar' | 'header'
  height?: number
  prompt?: string
  style?: CSSProperties
}) {
  const on = useSousOnPhone()
  useRegisterSous(on)
  if (!on) return null

  if (variant === 'bar') {
    const size = height ?? 54
    return (
      <button
        type="button"
        aria-label="Zapytaj Sous"
        title="Zapytaj Sous"
        onClick={() => requestChat(prompt)}
        style={{
          width: size,
          height: size,
          flex: `0 0 ${size}px`,
          borderRadius: size >= 52 ? 14 : 12,
          border: 0,
          background: 'var(--panel-bg)',
          color: 'var(--accent-warm)',
          fontSize: 20,
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          ...style,
        }}
      >
        ✦
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label="Zapytaj Sous"
      onClick={() => requestChat(prompt)}
      style={{
        height: 36,
        padding: '0 12px',
        borderRadius: 9,
        border: 0,
        background: 'var(--panel-bg)',
        color: 'var(--panel-text)',
        font: sans(13.5, 600),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}
    >
      <span style={{ color: 'var(--accent-warm)', fontSize: 13 }}>✦</span>
      Sous
    </button>
  )
}
