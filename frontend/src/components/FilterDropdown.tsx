import type { CSSProperties, ReactNode } from 'react'
import { CheckMark } from './icons'

export interface DropdownOption {
  label: string
  selected: boolean
  onSelect: () => void
}

// Filter pill + popover with a check on the selected row. The parent owns
// open/close state (one open menu at a time) and closes on outside clicks via
// the [data-dd] marker.
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
  /** Non-default value picked — ink-filled pill. */
  active: boolean
  /** Borderless text trigger (the sort control). */
  muted?: boolean
  align?: 'left' | 'right'
  leadingIcon?: ReactNode
  options: DropdownOption[]
}) {
  const pill: CSSProperties = muted
    ? { padding: '7px 4px 7px 12px', border: 0, background: 'transparent', color: 'var(--text-2)' }
    : {
        padding: '7px 12px',
        borderRadius: 999,
        border: active ? '1px solid var(--text)' : '1px solid var(--border)',
        background: active ? 'var(--text)' : open ? 'var(--surface)' : 'transparent',
        color: active ? 'var(--bg)' : 'var(--text)',
      }

  return (
    <div data-dd="1" style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{ ...pill, display: 'flex', alignItems: 'center', gap: 5, font: '500 13px var(--sans)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .14s, color .14s' }}
      >
        {leadingIcon}
        {label}
        <span aria-hidden style={{ fontSize: 10, opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            [align]: 0,
            zIndex: 40,
            minWidth: 190,
            maxHeight: 360,
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: '0 18px 40px -18px rgba(40,25,10,.45)',
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {options.map((op) => (
            <button
              key={op.label}
              type="button"
              onClick={op.onSelect}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                border: 0,
                borderRadius: 8,
                padding: '9px 11px',
                cursor: 'pointer',
                font: `${op.selected ? 600 : 500} 13.5px var(--sans)`,
                color: 'var(--text)',
                background: op.selected ? 'var(--seg-bg)' : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!op.selected) e.currentTarget.style.background = 'var(--bg)'
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
