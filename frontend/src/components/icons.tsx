import type { CSSProperties } from 'react'

// The redesign is text-first (no nav or button icons); only the menu tick remains.

type P = { size?: number; style?: CSSProperties; color?: string }

export const CheckMark = ({ size = 14, style, color = 'var(--text)' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="m5 12 5 5 9-11" />
  </svg>
)
