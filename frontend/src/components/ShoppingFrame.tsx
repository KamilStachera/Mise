import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useShopping, useSupplies } from '../api/hooks'
import { useIsMobile } from '../lib/useIsMobile'
import { TAB_BAR_HEIGHT } from './TabBar'
import { Eyebrow, PageTitle, Segmented, Sheet, mono, sans, usePagePad } from './ui'

export interface ListAction {
  label: string
  onClick: () => void
  danger?: boolean
}

/** Height of the phone's pinned add bar (52px field + padding). */
const ADD_BAR = 72

/**
 * Page frame shared by both shopping lists (Jedzenie / Dom). Desktop: the list
 * with its add field on the left, an aside with extra panels + list actions on
 * the right. Phone: actions behind a ··· sheet, the add field pinned above the
 * tab bar.
 */
export function ShoppingFrame({ counts, addBar, actions, aside, hint, children }: {
  counts: { food: number; home: number }
  addBar: ReactNode
  actions: ListAction[]
  aside?: ReactNode
  hint: string
  children: ReactNode
}) {
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [menu, setMenu] = useState(false)
  const tab = pathname.startsWith('/shopping/dom') ? 'home' : 'food'

  const tabs = (
    <Segmented
      value={tab}
      onChange={(k) => nav(k === 'home' ? '/shopping/dom' : '/shopping')}
      items={[
        { key: 'food', label: 'Jedzenie', count: counts.food },
        { key: 'home', label: 'Dom', count: counts.home },
      ]}
      style={isMobile ? undefined : { width: 260 }}
    />
  )

  if (isMobile) {
    return (
      <div style={{ ...pad, paddingBottom: addBar ? ADD_BAR + 24 : 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <PageTitle
          title="Zakupy"
          right={
            actions.length > 0 && (
              <button type="button" aria-label="Więcej" onClick={() => setMenu(true)} style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 16, letterSpacing: 1, color: 'var(--text)' }}>
                ···
              </button>
            )
          }
        />
        {tabs}
        {children}
        {addBar && (
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`, zIndex: 20, padding: '10px 16px', background: 'var(--bg)' }}>
            {addBar}
          </div>
        )}
        <Sheet open={menu} onClose={() => setMenu(false)} title="Lista">
          <ActionList actions={actions} onDone={() => setMenu(false)} />
          {aside && <div style={{ marginTop: 22 }}>{aside}</div>}
        </Sheet>
      </div>
    )
  }

  return (
    <div style={{ ...pad, maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 56, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}>
        <PageTitle title="Zakupy" right={tabs} />
        {addBar}
        {children}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, paddingTop: 12 }}>
        {aside}
        {actions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 20, paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>Lista</span>
            <ActionList actions={actions} />
          </div>
        )}
        <p style={{ margin: 0, font: sans(14), lineHeight: 1.5, color: 'var(--text-2)' }}>{hint}</p>
      </div>
    </div>
  )
}

function ActionList({ actions, onDone }: { actions: ListAction[]; onDone?: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={() => {
            a.onClick()
            onDone?.()
          }}
          style={{ height: 46, display: 'flex', alignItems: 'center', padding: 0, border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', font: sans(14.5, 600), color: a.danger ? 'var(--accent-text)' : 'var(--text)', textAlign: 'left' }}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

/** Add field with the accent + button; Enter submits. */
export function AddBar({ value, onChange, onSubmit, placeholder }: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder: string
}) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, height: 52, padding: '0 16px', borderRadius: 14, border: '1px solid var(--rule)', background: 'var(--surface)', font: sans(15), color: 'var(--text)' }}
      />
      <button
        type="button"
        onClick={onSubmit}
        aria-label="Dodaj"
        style={{ width: 52, height: 52, flex: '0 0 52px', border: 0, borderRadius: 14, background: 'var(--accent)', color: '#fff', font: sans(24, 500), cursor: 'pointer' }}
      >
        +
      </button>
    </div>
  )
}

/** "1 z 4 w koszyku" + optional right control + sage progress bar. */
export function Progress({ done, total, right }: { done: number; total: number; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, font: mono(12), color: 'var(--text-2)' }}>
        <span>{done} z {total} w koszyku</span>
        {right}
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--border)' }}>
        <span style={{ display: 'block', width: `${total ? (done / total) * 100 : 0}%`, height: '100%', borderRadius: 2, background: 'var(--sage)', transition: 'width .25s' }} />
      </div>
    </div>
  )
}

/** Group of check rows under a mono caps label. */
export function CheckGroup({ label, thin, children }: { label: ReactNode; thin?: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {label && <Eyebrow style={{ paddingBottom: 8, borderBottom: `1px solid ${thin ? 'var(--border)' : 'var(--rule)'}` }}>{label}</Eyebrow>}
      {children}
    </div>
  )
}

/** One shopping row: box, name (+ muted sub line), mono quantity, ✕. Tapping the row toggles it. */
export function CheckRow({ checked, name, sub, qty, onToggle, onRemove, last }: {
  checked: boolean
  name: string
  sub?: string | null
  qty?: string | null
  onToggle?: () => void
  onRemove?: () => void
  last?: boolean
}) {
  const isMobile = useIsMobile()
  const box = isMobile ? 26 : 24
  return (
    <div
      onClick={onToggle}
      style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 14 : 16, padding: isMobile ? '13px 0' : '14px 0', borderBottom: last ? 0 : '1px solid var(--border)', cursor: onToggle ? 'pointer' : 'default', color: checked ? 'var(--text-3)' : 'var(--text)' }}
    >
      <span
        style={{
          width: box,
          height: box,
          flex: `0 0 ${box}px`,
          borderRadius: isMobile ? 8 : 7,
          border: checked ? 0 : '1.5px solid var(--rule)',
          background: checked ? 'var(--sage)' : 'transparent',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        {checked && '✓'}
      </span>
      {isMobile ? (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ font: sans(16, checked ? 400 : 500), textDecoration: checked ? 'line-through' : undefined }}>{name}</span>
          {sub && !checked && <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>{sub}</span>}
        </span>
      ) : (
        <>
          <span style={{ flex: 1, minWidth: 0, font: sans(16, checked ? 400 : 500), textDecoration: checked ? 'line-through' : undefined }}>{name}</span>
          {sub && <span style={{ font: sans(13), color: 'var(--text-3)', textAlign: 'right', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
        </>
      )}
      {qty != null && <span style={{ width: isMobile ? undefined : 80, textAlign: 'right', font: mono(13), color: checked ? undefined : 'var(--text-2)' }}>{qty}</span>}
      {onRemove ? (
        <button
          type="button"
          title="Usuń z listy"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          style={{ width: isMobile ? 32 : 20, border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-3)', fontSize: 14, padding: 0 }}
        >
          ✕
        </button>
      ) : (
        !isMobile && <span style={{ width: 20 }} />
      )}
    </div>
  )
}

/** Unchecked rows per list — the counts on the Jedzenie / Dom tabs. */
export function useShoppingCounts(): { food: number; home: number } {
  const { data: food } = useShopping()
  const { data: home } = useSupplies()
  return {
    food: food ? food.total - food.checkedCount : 0,
    home: home ? home.total - home.checkedCount : 0,
  }
}
