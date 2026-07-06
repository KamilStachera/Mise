import type { CSSProperties, ReactNode } from 'react'
import { CheckMark, ChevronDown } from './icons'

export interface DropdownOption {
  label: string
  selected: boolean
  onSelect: () => void
}

// Toolbar dropdown pill from the design: closed pill + card popover with a check
// on the selected row. The parent owns open/close state (one open menu at a time)
// and closes on outside clicks via the [data-dd] marker.
export function FilterDropdown({
  open,
  onToggle,
  label,
  active,
  muted = false,
  align = 'left',
  leadingIcon,
  options,
}: {
  open: boolean
  onToggle: () => void
  label: string
  /** Non-default value picked — accent-tinted pill. */
  active: boolean
  /** Quieter text when inactive (the sort pill). */
  muted?: boolean
  align?: 'left' | 'right'
  leadingIcon?: ReactNode
  options: DropdownOption[]
}) {
  const pill: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    border: 'none',
    background: active ? 'var(--accent-soft)' : open ? 'var(--card)' : 'transparent',
    color: active ? 'var(--accent-deep)' : muted ? 'var(--text-2)' : 'var(--text)',
    borderRadius: 9,
    padding: '7px 10px',
    font: "600 13px 'Hanken Grotesk'",
    cursor: 'pointer',
    transition: 'background .13s, color .13s',
    whiteSpace: 'nowrap',
  }

  return (
    <div data-dd="1" style={{ position: 'relative' }}>
      <button onClick={onToggle} style={pill}>
        {leadingIcon}
        {label}
        <ChevronDown style={{ transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none', opacity: 0.55 }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 7px)',
            [align]: 0,
            zIndex: 40,
            minWidth: 176,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 13,
            boxShadow: '0 16px 38px rgba(70,50,25,.18)',
            padding: 5,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {options.map((op) => (
            <button
              key={op.label}
              onClick={op.onSelect}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                border: 'none',
                borderRadius: 9,
                padding: '8px 11px',
                cursor: 'pointer',
                font: `${op.selected ? 600 : 500} 13px 'Hanken Grotesk'`,
                color: op.selected ? 'var(--accent-deep)' : 'var(--text)',
                background: op.selected ? 'var(--accent-soft)' : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!op.selected) e.currentTarget.style.background = 'var(--surface)'
              }}
              onMouseLeave={(e) => {
                if (!op.selected) e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={{ flex: 1, textAlign: 'left' }}>{op.label}</span>
              {op.selected && <CheckMark />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
