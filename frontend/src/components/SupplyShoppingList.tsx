import { useState, type CSSProperties } from 'react'
import {
  useAuth, useSupplies, useAddSupply, useCheckSupply, useDeleteSupply,
  useClearCheckedSupplies, useClearSupplies, useUpdateHotSupply, useForgetHotSupply,
  useAllHotSupplies,
} from '../api/hooks'
import { supplyCategoryLabel } from '../lib/labels'
import { supplyGroups, suppliesAsText } from '../lib/supplies'
import { useIsMobile } from '../lib/useIsMobile'
import { CheckIcon, PlusIcon } from './icons'

const secondaryBtn: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text-2)',
  borderRadius: 11,
  padding: '10px 14px',
  cursor: 'pointer',
  font: "500 13px 'Hanken Grotesk'",
  whiteSpace: 'nowrap',
}

export function SupplyShoppingList() {
  const isMobile = useIsMobile()
  const { canEdit } = useAuth()
  const { data, isLoading } = useSupplies()
  const add = useAddSupply()
  const check = useCheckSupply()
  const remove = useDeleteSupply()
  const clear = useClearCheckedSupplies()
  const clearAll = useClearSupplies()
  const updateHot = useUpdateHotSupply()
  const forgetHot = useForgetHotSupply()
  const [name, setName] = useState('')
  const [copied, setCopied] = useState(false)
  const [managing, setManaging] = useState(false)

  const items = data?.items ?? []
  const hot = data?.hot ?? []
  const groups = supplyGroups(items)
  const total = data?.total ?? 0
  const done = data?.checkedCount ?? 0
  const doneLabel = done > 0 ? `Odhaczono ${done} z ${total}.` : `${total} do kupienia.`

  function submit() {
    if (!name.trim()) return
    add.mutate({ name: name.trim() })
    setName('')
  }

  async function copyList() {
    await navigator.clipboard.writeText(suppliesAsText(items))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <>
      <p style={{ fontSize: 14.5, color: 'var(--text-2)', margin: '0 0 22px' }}>
        Chemia, higiena, papier — nic wspólnego ze spiżarnią. {total > 0 && doneLabel}
      </p>

      {canEdit && hot.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ font: "600 11px 'Hanken Grotesk'", letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 9 }}>
            Częste
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {hot.map((h) => (
              <button
                key={h.id}
                onClick={() => add.mutate({ name: h.name })}
                title={`Dodaj: ${h.name}`}
                style={{
                  border: '1px solid ' + (h.pinned ? 'var(--accent)' : 'var(--border)'),
                  background: 'var(--card)',
                  color: h.pinned ? 'var(--accent-deep)' : 'var(--text-2)',
                  borderRadius: 20,
                  padding: isMobile ? '9px 14px' : '8px 14px',
                  font: "500 13px 'Hanken Grotesk'",
                  cursor: 'pointer',
                  transition: 'all .14s',
                }}
              >
                {h.pinned && '📌 '}+ {h.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {canEdit && (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Dodaj coś do domu…"
              style={{ flex: 1, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 11, padding: '10px 14px', font: "400 14px 'Hanken Grotesk'", color: 'var(--text)' }}
            />
            <button
              onClick={submit}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 11, padding: '10px 14px', cursor: 'pointer', font: "600 13.5px 'Hanken Grotesk'" }}
            >
              <PlusIcon />
            </button>
          </>
        )}
        {items.some((s) => !s.checked) && (
          <button onClick={copyList} style={{ ...secondaryBtn, color: copied ? 'var(--sage)' : 'var(--text-2)' }}>
            {copied ? '✓ Skopiowano' : 'Kopiuj listę'}
          </button>
        )}
        {canEdit && done > 0 && (
          <button onClick={() => clear.mutate()} style={secondaryBtn}>
            Usuń odhaczone
          </button>
        )}
        {canEdit && total > 0 && (
          <button
            onClick={() => {
              if (window.confirm(`Wyczyścić całą listę domową (pozycji: ${total})?`)) clearAll.mutate()
            }}
            style={{ ...secondaryBtn, color: 'var(--accent)' }}
          >
            Wyczyść listę
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-3)', padding: 40 }}>Ładowanie…</div>
      ) : items.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 36, textAlign: 'center', color: 'var(--text-3)' }}>
          Lista jest pusta. Dopisz coś ręcznie albo stuknij w częstą rzecz powyżej.
        </div>
      ) : (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          {groups.map((group) => (
            <div key={group.key}>
              <div style={{ padding: isMobile ? '11px 14px 8px' : '10px 17px 7px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', font: "650 11px 'Hanken Grotesk'", letterSpacing: '.08em', textTransform: 'uppercase', color: group.key === 'checked' ? 'var(--text-3)' : 'var(--sage)' }}>
                {group.label}
              </div>
              {group.items.map((s) => (
                <div
                  key={s.id}
                  onClick={() => canEdit && check.mutate(s.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 13, padding: isMobile ? '15px 14px' : '14px 17px', borderBottom: '1px solid var(--border)', cursor: canEdit ? 'pointer' : 'default' }}
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
                  <div style={{ flex: 1, minWidth: 0, font: `600 ${isMobile ? 16 : 14.5}px 'Hanken Grotesk'`, color: s.checked ? 'var(--text-3)' : 'var(--text)', textDecoration: s.checked ? 'line-through' : 'none' }}>
                    {s.name}
                  </div>
                  {!isMobile && s.checked && (
                    <span style={{ font: "500 11px 'Hanken Grotesk'", color: 'var(--text-3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 9px' }}>
                      {supplyCategoryLabel[s.category]}
                    </span>
                  )}
                  {canEdit && (
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
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div style={{ marginTop: 18 }}>
          <button
            onClick={() => setManaging((v) => !v)}
            style={{ border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', font: "600 11px 'Hanken Grotesk'", letterSpacing: '.08em', textTransform: 'uppercase', padding: 0 }}
          >
            {managing ? '− ' : '+ '}Zarządzaj częstymi
          </button>
          {managing && <HotManager onUpdate={updateHot.mutate} onForget={forgetHot.mutate} />}
        </div>
      )}
    </>
  )
}

/**
 * Pin / hide / forget the learned tallies. Kept behind a toggle so the chip row above
 * stays a one-tap affordance rather than a settings screen. It lists every entry, not
 * just the visible chips — otherwise there is no way to unhide something, or to pin
 * something currently ranked below the cap.
 */
function HotManager({ onUpdate, onForget }: {
  onUpdate: (args: { id: string; pinned?: boolean; hidden?: boolean }) => void
  onForget: (id: string) => void
}) {
  const { data, isLoading } = useAllHotSupplies(true)

  if (isLoading) return <div style={{ color: 'var(--text-3)', padding: 14 }}>Ładowanie…</div>

  return (
    <div style={{ marginTop: 10, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
      {(data ?? []).map((h) => (
        <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', opacity: h.hidden ? 0.55 : 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "600 13.5px 'Hanken Grotesk'", color: 'var(--text)' }}>{h.name}</div>
            <div style={{ font: "500 11px 'Hanken Grotesk'", color: 'var(--text-3)' }}>
              {supplyCategoryLabel[h.category]} · dodane {h.count}×{h.hidden && ' · ukryte'}
            </div>
          </div>
          <button
            onClick={() => onUpdate({ id: h.id, pinned: !h.pinned })}
            title={h.pinned ? 'Odepnij' : 'Przypnij na stałe'}
            style={{ border: '1px solid ' + (h.pinned ? 'var(--accent)' : 'var(--border)'), background: 'var(--card)', color: h.pinned ? 'var(--accent-deep)' : 'var(--text-2)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', font: "500 12px 'Hanken Grotesk'", whiteSpace: 'nowrap' }}
          >
            {h.pinned ? '📌 Przypięte' : 'Przypnij'}
          </button>
          <button
            onClick={() => onUpdate({ id: h.id, hidden: !h.hidden })}
            title={h.hidden ? 'Podpowiadaj znowu' : 'Nie podpowiadaj tego'}
            style={{ border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text-2)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', font: "500 12px 'Hanken Grotesk'", whiteSpace: 'nowrap' }}
          >
            {h.hidden ? 'Pokaż' : 'Ukryj'}
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Zapomnieć „${h.name}" i jego statystyki?`)) onForget(h.id)
            }}
            title="Zapomnij razem ze statystykami"
            style={{ border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', font: "600 15px 'Hanken Grotesk'", padding: '2px 6px', borderRadius: 7, lineHeight: 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
