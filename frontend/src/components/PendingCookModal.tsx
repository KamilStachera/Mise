import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAddCookLog, useAuth, useDismissCookReminder, usePendingCook } from '../api/hooks'
import type { PlanEntry } from '../api/client'
import { showToast } from '../lib/toastBus'
import { slotLabel } from '../lib/labels'
import { parseISODate } from '../lib/dates'

// Shown at most once per browser session, so navigating around the app
// doesn't re-nag; a fresh tab or the next visit asks again.
const SESSION_KEY = 'pichci.pendingCookSeen'

/**
 * Login/entry reminder: past plan entries that never got a cook-log entry.
 * Each row can be logged as cooked (dated on the planned day — rating and note
 * can be added later from Historia) or dismissed for good (meal skipped).
 */
export function PendingCookModal() {
  const nav = useNavigate()
  const { canEdit } = useAuth()
  const { data: pending = [], isLoading } = usePendingCook(canEdit)
  const [closed, setClosed] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')

  if (!canEdit || isLoading || closed || pending.length === 0) return null

  function close() {
    sessionStorage.setItem(SESSION_KEY, '1')
    setClosed(true)
  }

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'rgba(46,34,20,.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          padding: '22px 24px',
          width: 'min(480px, 100%)',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 18px 50px rgba(50,35,18,.28)',
        }}
      >
        <div style={{ font: "600 11px var(--sans)", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>
          Dziennik kuchenny
        </div>
        <h2 style={{ fontFamily: "var(--serif)", fontWeight: 600, fontSize: 24, margin: '0 0 4px', color: 'var(--text)' }}>
          Zaległe posiłki z planu
        </h2>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '0 0 16px', lineHeight: 1.45 }}>
          Te zaplanowane posiłki nie mają wpisu w historii. Ugotowane? Ocenę i notatkę
          dopiszesz później w Historii.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {pending.map((e) => (
            <PendingRow key={e.id} entry={e} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => { close(); nav('/plan') }}
            style={{ border: '1px solid var(--border-2)', background: 'transparent', color: 'var(--text-2)', borderRadius: 10, padding: '8px 14px', font: "600 12.5px var(--sans)", cursor: 'pointer' }}
          >
            Otwórz plan
          </button>
          <button
            onClick={close}
            style={{ border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '8px 16px', font: "600 12.5px var(--sans)", cursor: 'pointer' }}
          >
            Przypomnij później
          </button>
        </div>
      </div>
    </div>
  )
}

function PendingRow({ entry }: { entry: PlanEntry }) {
  const addLog = useAddCookLog()
  const dismiss = useDismissCookReminder()
  const busy = addLog.isPending || dismiss.isPending
  const title = entry.recipeTitle ?? entry.title
  const date = parseISODate(entry.date)
  const when = date.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long' })

  function markCooked() {
    addLog.mutate(
      {
        recipeId: entry.recipeId ?? undefined,
        dishName: entry.recipeId ? undefined : title,
        cookedAt: entry.date,
      },
      { onSuccess: () => showToast(`Zapisano w historii: ${title}.`) },
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "600 14px var(--sans)", color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div style={{ font: "500 11.5px var(--sans)", color: 'var(--text-3)', marginTop: 1 }}>
          {when} · {slotLabel[entry.slot]}
        </div>
      </div>
      <button
        onClick={markCooked}
        disabled={busy}
        title="Dodaj wpis do historii z datą z planu"
        style={{ border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 9, padding: '7px 12px', font: "600 12px var(--sans)", cursor: 'pointer', whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1 }}
      >
        ✓ Ugotowane
      </button>
      <button
        onClick={() => dismiss.mutate(entry.id)}
        disabled={busy}
        title="Nie przypominaj o tym posiłku (np. pominięty)"
        style={{ border: '1px solid var(--border-2)', background: 'transparent', color: 'var(--text-2)', borderRadius: 9, padding: '7px 12px', font: "600 12px var(--sans)", cursor: 'pointer', whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1 }}
      >
        Pomiń
      </button>
    </div>
  )
}
