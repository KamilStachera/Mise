// Shared building blocks of the 2026-10 redesign: ink rules instead of cards,
// Newsreader titles, mono numbers, one accent. Inline styles + tokens.css
// variables, like the rest of the app.
import { useEffect, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { useIsMobile } from '../lib/useIsMobile'

export const mono = (size: number, weight = 400) => `${weight} ${size}px var(--mono)`
export const sans = (size: number, weight = 400) => `${weight} ${size}px var(--sans)`

/** Thin rule under a list row. */
export const rowRule: CSSProperties = { borderBottom: '1px solid var(--border)' }

// ---- typography ----

/** Page title (Newsreader) with an optional mono superscript count, subtitle and right-hand slot. */
export function PageTitle({ title, count, sub, right, size }: {
  title: ReactNode
  count?: number
  sub?: ReactNode
  right?: ReactNode
  size?: number
}) {
  const isMobile = useIsMobile()
  const fs = size ?? (isMobile ? 44 : 64)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: isMobile ? 12 : 24, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 8 : 12, minWidth: isMobile ? 0 : 320, flex: isMobile ? undefined : '1 1 0' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: fs, lineHeight: isMobile ? 1 : 0.95, letterSpacing: '-0.03em' }}>
          {title}
          {count != null && (
            <sup style={{ font: mono(isMobile ? 12 : 13, 500), letterSpacing: 0, color: 'var(--text-3)', verticalAlign: 'top', marginLeft: isMobile ? 4 : 6 }}>
              {count}
            </sup>
          )}
        </h1>
        {sub && <p style={{ margin: 0, maxWidth: 680, font: sans(isMobile ? 14 : 15), lineHeight: 1.5, color: 'var(--text-2)', textWrap: 'pretty' as never }}>{sub}</p>}
      </div>
      {right}
    </div>
  )
}

/** 11px mono caps label. */
export function Eyebrow({ children, tone = 'muted', size = 11, style }: {
  children: ReactNode
  tone?: 'muted' | 'accent' | 'light' | 'ink'
  size?: number
  style?: CSSProperties
}) {
  const color = { muted: 'var(--text-3)', accent: 'var(--accent-text)', light: '#c9bca8', ink: 'var(--text)' }[tone]
  return (
    <span style={{ font: mono(size, 500), letterSpacing: '.1em', textTransform: 'uppercase', color, ...style }}>{children}</span>
  )
}

/** Serif section title + mono meta, sitting on a strong rule. */
export function SectionHead({ title, meta, size = 22, style }: { title: ReactNode; meta?: ReactNode; size?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingBottom: 8, borderBottom: '1px solid var(--rule)', ...style }}>
      <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: size }}>{title}</span>
      {meta != null && <span style={{ font: mono(12), color: 'var(--text-2)', textAlign: 'right' }}>{meta}</span>}
    </div>
  )
}

/** Mono caps group label on a strong (or thin) rule — list sections. */
export function GroupLabel({ children, thin, style }: { children: ReactNode; thin?: boolean; style?: CSSProperties }) {
  return (
    <div style={{ paddingBottom: 8, borderBottom: `1px solid ${thin ? 'var(--border)' : 'var(--rule)'}`, ...style }}>
      <Eyebrow>{children}</Eyebrow>
    </div>
  )
}

// ---- controls ----

type ButtonVariant = 'primary' | 'dark' | 'outline' | 'quiet' | 'text'
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

export function buttonStyle(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): CSSProperties {
  const h = { sm: 38, md: 46, lg: 50, xl: 54 }[size]
  const base: CSSProperties = {
    height: h,
    padding: variant === 'text' ? 0 : size === 'sm' ? '0 14px' : '0 20px',
    borderRadius: size === 'sm' ? 999 : size === 'xl' ? 14 : 12,
    font: sans(size === 'sm' ? 14 : 15, 600),
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'background .15s, color .15s, opacity .15s',
  }
  switch (variant) {
    case 'primary':
      return { ...base, border: 0, background: 'var(--accent)', color: '#fff' }
    case 'dark':
      return { ...base, border: 0, background: 'var(--text)', color: 'var(--bg)' }
    case 'outline':
      return { ...base, border: '1px solid var(--rule)', background: 'transparent', color: 'var(--text)' }
    case 'quiet':
      return { ...base, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }
    case 'text':
      return { ...base, height: 'auto', border: 0, background: 'transparent', color: 'var(--text-2)' }
  }
}

export function Button({ variant = 'primary', size = 'md', style, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{ ...buttonStyle(variant, size), ...(disabled ? { opacity: 0.45, cursor: 'not-allowed' } : null), ...style }}
    />
  )
}

/** Pill chip. Active = ink fill. */
export function Chip({ active, onClick, children, style, title }: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  style?: CSSProperties
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        padding: '7px 12px',
        borderRadius: 999,
        border: active ? '1px solid var(--text)' : '1px solid var(--border)',
        background: active ? 'var(--text)' : 'transparent',
        color: active ? 'var(--bg)' : 'var(--text)',
        font: sans(13, 500),
        cursor: onClick ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
        transition: 'background .14s, color .14s',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

export interface TabItem<K extends string> {
  key: K
  label: ReactNode
  count?: number
}

/** Text tabs with a 3px accent underline on the active one. */
export function UnderlineTabs<K extends string>({ items, value, onChange, rule = true, style }: {
  items: TabItem<K>[]
  value: K
  onChange: (k: K) => void
  rule?: boolean
  style?: CSSProperties
}) {
  const isMobile = useIsMobile()
  return (
    <div
      className="no-scrollbar"
      style={{
        display: 'flex',
        gap: isMobile ? 20 : 28,
        overflowX: 'auto',
        borderBottom: rule ? '1px solid var(--rule)' : undefined,
        ...style,
      }}
    >
      {items.map((t) => {
        const on = t.key === value
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            style={{
              padding: `0 0 ${isMobile ? 9 : 12}px`,
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              font: sans(isMobile ? 14 : 15, 600),
              color: on ? 'var(--text)' : 'var(--text-3)',
              boxShadow: on ? 'inset 0 -3px 0 var(--accent)' : undefined,
            }}
          >
            {t.label}
            {t.count != null && <span style={{ font: mono(12), marginLeft: 5 }}>{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Two-or-more option segmented control (Jedzenie / Dom). */
export function Segmented<K extends string>({ items, value, onChange, style }: {
  items: TabItem<K>[]
  value: K
  onChange: (k: K) => void
  style?: CSSProperties
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, padding: 4, borderRadius: 12, background: 'var(--seg-bg)', ...style }}>
      {items.map((t) => {
        const on = t.key === value
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            style={{
              height: 36,
              border: 0,
              borderRadius: 9,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              font: sans(14, 600),
              background: on ? 'var(--surface)' : 'transparent',
              color: on ? 'var(--text)' : 'var(--text-2)',
              boxShadow: on ? '0 1px 2px rgba(40,25,10,.12)' : undefined,
            }}
          >
            {t.label}
            {t.count != null && t.count > 0 && <span style={{ font: mono(12, 500), color: 'var(--accent-text)' }}>{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** 44×26 switch, sage when on. Renders as a full-width labelled row when `label` is given. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  const knob = (
    <span
      style={{
        width: 44,
        height: 26,
        flex: '0 0 44px',
        borderRadius: 13,
        background: on ? 'var(--sage)' : 'var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: on ? 'flex-end' : 'flex-start',
        padding: 3,
        transition: 'background .15s',
      }}
    >
      <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--surface)' }} />
    </span>
  )
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        width: label ? '100%' : undefined,
        padding: label ? '14px 0' : 0,
        border: 0,
        borderBottom: label ? '1px solid var(--border)' : 0,
        background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        font: sans(15),
        color: 'var(--text)',
        textAlign: 'left',
      }}
    >
      {label && <span>{label}</span>}
      {knob}
    </button>
  )
}

export function SearchField({ value, onChange, placeholder, style }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  style?: CSSProperties
}) {
  return (
    <label
      style={{
        height: 46,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 14px',
        borderRadius: 12,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        cursor: 'text',
        ...style,
      }}
    >
      <span style={{ width: 12, height: 12, flex: '0 0 12px', border: '1.5px solid var(--text-3)', borderRadius: '50%' }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', font: sans(15), color: 'var(--text)' }}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Wyczyść" style={{ border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: 13 }}>
          ✕
        </button>
      )}
    </label>
  )
}

/** Plain text input in the redesign's style. */
export const inputStyle: CSSProperties = {
  height: 46,
  padding: '0 14px',
  borderRadius: 12,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  font: sans(15),
  color: 'var(--text)',
  width: '100%',
  minWidth: 0,
}

// ---- data display ----

export type Status = 'in' | 'low' | 'out' | 'unknown'

export const statusDotColor: Record<Status, string> = {
  in: 'var(--sage)',
  low: 'var(--gold)',
  out: 'var(--accent)',
  unknown: 'var(--border-2)',
}

export function StatusDot({ status, size = 8 }: { status: Status; size?: number }) {
  return <span style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: '50%', background: statusDotColor[status] }} />
}

export interface StatItem {
  value: ReactNode
  label: ReactNode
  /** Render the value in serif (for words) instead of mono (for numbers). */
  serif?: boolean
  highlight?: boolean
  active?: boolean
  onClick?: () => void
}

/** Equal columns between strong rules: big mono number + small label. */
export function StatStrip({ items, stacked, style }: { items: StatItem[]; stacked?: boolean; style?: CSSProperties }) {
  const isMobile = useIsMobile()
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        borderTop: '1px solid var(--rule)',
        borderBottom: '1px solid var(--rule)',
        ...style,
      }}
    >
      {items.map((s, i) => {
        const Tag = s.onClick ? 'button' : 'div'
        return (
          <Tag
            key={i}
            type={s.onClick ? 'button' : undefined}
            onClick={s.onClick}
            style={{
              display: 'flex',
              flexDirection: stacked || isMobile ? 'column' : 'row',
              alignItems: stacked || isMobile ? 'flex-start' : 'baseline',
              gap: stacked || isMobile ? 4 : 12,
              minWidth: 0,
              padding: i === 0 && !s.highlight ? (isMobile ? '10px 0' : '14px 0') : isMobile ? '10px 0 10px 14px' : '14px 20px',
              border: 0,
              borderLeft: i === 0 ? 0 : '1px solid var(--border)',
              background: s.highlight ? 'var(--accent-soft)' : 'transparent',
              boxShadow: s.active ? 'inset 0 -3px 0 var(--accent)' : undefined,
              cursor: s.onClick ? 'pointer' : 'default',
              textAlign: 'left',
              color: 'var(--text)',
            }}
          >
            <span
              style={
                s.serif
                  ? { fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 22 : 26, lineHeight: isMobile ? '26px' : '34px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }
                  : { font: mono(isMobile ? 22 : 28, 500) }
              }
            >
              {s.value}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: sans(isMobile ? 13 : 14), color: s.highlight ? 'var(--text)' : 'var(--text-2)' }}>{s.label}</span>
          </Tag>
        )
      })}
    </div>
  )
}

/** Initial-letter avatar (or Google picture). */
export function Avatar({ name, picture, size = 30 }: { name?: string | null; picture?: string | null; size?: number }) {
  if (picture)
    return <img src={picture} alt="" referrerPolicy="no-referrer" style={{ width: size, height: size, borderRadius: '50%', flex: `0 0 ${size}px` }} />
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: '50%',
        background: 'var(--accent)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--serif)',
        fontSize: Math.round(size * 0.53),
      }}
    >
      {(name?.trim()[0] ?? 'P').toUpperCase()}
    </span>
  )
}

/** "Pichci." wordmark. */
export function Wordmark({ size = 32 }: { size?: number }) {
  return (
    <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: size, letterSpacing: '-0.03em', lineHeight: 1 }}>
      Pichci<span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>.</span>
    </span>
  )
}

// ---- overlays ----

/** Bottom sheet on phones, centred dialog on desktop. Escape / backdrop closes. */
export function Sheet({ open, onClose, title, children, width = 480 }: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  width?: number
}) {
  const isMobile = useIsMobile()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(29,24,19,.38)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 24,
      }}
    >
      <div
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isMobile ? '100%' : width,
          maxWidth: '100%',
          maxHeight: isMobile ? '88dvh' : 'min(760px, 90dvh)',
          overflowY: 'auto',
          background: 'var(--bg)',
          borderRadius: isMobile ? '20px 20px 0 0' : 16,
          padding: isMobile ? '18px 20px calc(20px + env(safe-area-inset-bottom))' : '24px 26px 26px',
          boxShadow: '0 40px 90px -40px rgba(40,25,10,.55), 0 0 0 1px rgba(29,24,19,.18)',
          animation: 'sheetUp .2s ease',
        }}
      >
        {isMobile && <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 14px' }} />}
        {title && (
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingBottom: 10, marginBottom: 14, borderBottom: '1px solid var(--rule)' }}>
            <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 24 }}>{title}</span>
            <button type="button" onClick={onClose} aria-label="Zamknij" style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 15, color: 'var(--text-2)' }}>
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

/** Standard page padding: generous on desktop, 20px gutters on phones. */
export function usePagePad(): CSSProperties {
  const isMobile = useIsMobile()
  return isMobile ? { padding: '18px 20px 28px' } : { padding: '40px 48px 64px' }
}
