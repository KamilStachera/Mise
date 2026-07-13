import { useState } from 'react'
import { useShopping, useCheckShopping, useClearChecked, useAddShopping, useDeleteShopping } from '../api/hooks'
import type { ShoppingItem } from '../api/client'
import { categoryLabel, formatQty } from '../lib/labels'
import { useIsMobile } from '../lib/useIsMobile'
import { CheckIcon, PlusIcon } from '../components/icons'

/** Plain-text list for messaging apps; unchecked items only. */
function listAsText(items: ShoppingItem[]): string {
  return items
    .filter((s) => !s.checked)
    .map((s) => {
      const qty = s.quantity != null && s.unit ? ` — ${formatQty(s.quantity, s.unit)}` : ''
      const reason = s.reason ? ` (${s.reason})` : ''
      return `• ${s.name}${qty}${reason}`
    })
    .join('\n')
}

export function Shopping() {
  const isMobile = useIsMobile()
  const { data, isLoading } = useShopping()
  const check = useCheckShopping()
  const clear = useClearChecked()
  const add = useAddShopping()
  const remove = useDeleteShopping()
  const [name, setName] = useState('')
  const [copied, setCopied] = useState(false)

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const done = data?.checkedCount ?? 0
  const doneLabel = done > 0 ? `Odhaczono ${done} z ${total}.` : `${total} do kupienia.`

  async function copyList() {
    await navigator.clipboard.writeText(listAsText(items))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div style={{ maxWidth: 660, margin: '0 auto', padding: isMobile ? '22px 14px 28px' : '38px 42px 60px' }}>
      <div style={{ font: "600 11px 'Hanken Grotesk'", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 7 }}>
        Do kupienia
      </div>
      <h1 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: isMobile ? 30 : 38, margin: '0 0 5px' }}>Lista zakupów</h1>
      <p style={{ fontSize: 14.5, color: 'var(--text-2)', margin: '0 0 22px' }}>
        Dodawaj ręcznie, z przepisów albo przez asystenta. {total > 0 && doneLabel}
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              add.mutate({ name: name.trim() })
              setName('')
            }
          }}
          placeholder="Dodaj coś do kupienia…"
          style={{ flex: 1, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 11, padding: '10px 14px', font: "400 14px 'Hanken Grotesk'", color: 'var(--text)' }}
        />
        <button
          onClick={() => {
            if (name.trim()) {
              add.mutate({ name: name.trim() })
              setName('')
            }
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 11, padding: '10px 14px', cursor: 'pointer', font: "600 13.5px 'Hanken Grotesk'" }}
        >
          <PlusIcon />
        </button>
        {items.some((s) => !s.checked) && (
          <button
            onClick={copyList}
            style={{ border: '1px solid var(--border)', background: 'var(--card)', color: copied ? 'var(--sage)' : 'var(--text-2)', borderRadius: 11, padding: '10px 14px', cursor: 'pointer', font: "500 13px 'Hanken Grotesk'", whiteSpace: 'nowrap' }}
          >
            {copied ? '✓ Skopiowano' : 'Kopiuj listę'}
          </button>
        )}
        {done > 0 && (
          <button
            onClick={() => clear.mutate()}
            style={{ border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text-2)', borderRadius: 11, padding: '10px 14px', cursor: 'pointer', font: "500 13px 'Hanken Grotesk'", whiteSpace: 'nowrap' }}
          >
            Usuń odhaczone
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-3)', padding: 40 }}>Ładowanie…</div>
      ) : items.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 36, textAlign: 'center', color: 'var(--text-3)' }}>
          Lista jest pusta. Dodaj coś ręcznie albo z brakujących składników przepisu.
        </div>
      ) : (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          {items.map((s) => (
            <div
              key={s.id}
              onClick={() => check.mutate(s.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 13, padding: isMobile ? '15px 14px' : '14px 17px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
            >
              <span
                style={{
                  flex: `0 0 ${isMobile ? 26 : 22}px`,
                  width: isMobile ? 26 : 22,
                  height: isMobile ? 26 : 22,
                  borderRadius: 8,
                  border: '2px solid ' + (s.checked ? 'var(--sage)' : 'var(--border-2)'),
                  background: s.checked ? 'var(--sage)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all .12s',
                }}
              >
                {s.checked && <CheckIcon />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `600 ${isMobile ? 16 : 14.5}px 'Hanken Grotesk'`, color: s.checked ? 'var(--text-3)' : 'var(--text)', textDecoration: s.checked ? 'line-through' : 'none' }}>
                  {s.name}
                  {s.quantity != null && s.unit && (
                    <span style={{ font: "500 12.5px 'Spline Sans Mono'", color: 'var(--text-2)', marginLeft: 8 }}>
                      {formatQty(s.quantity, s.unit)}
                    </span>
                  )}
                </div>
                <div style={{ font: "500 11.5px 'Hanken Grotesk'", color: 'var(--text-3)' }}>{s.reason}</div>
              </div>
              {!isMobile && (
                <span style={{ font: "500 11px 'Hanken Grotesk'", color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 9px' }}>
                  {categoryLabel(s.category)}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  remove.mutate(s.id)
                }}
                title="Usuń z listy"
                style={{ border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', font: "600 15px 'Hanken Grotesk'", padding: isMobile ? '10px 12px' : '2px 6px', borderRadius: 7, lineHeight: 1 }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
