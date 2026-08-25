import { useState } from 'react'
import { useAuth, useShopping, useCheckShopping, useClearChecked, useClearShopping, useAddShopping, useDeleteShopping } from '../api/hooks'
import { categoryLabel, formatQty } from '../lib/labels'
import { alphabeticalShoppingGroups, lidlShoppingGroups, shoppingListAsText, type ShoppingLayout } from '../lib/shoppingAisles'
import { useIsMobile } from '../lib/useIsMobile'
import { CheckIcon, PlusIcon } from './icons'

const LAYOUT_STORAGE_KEY = 'pichci.shopping.layout'

function savedLayout(): ShoppingLayout {
  try {
    return localStorage.getItem(LAYOUT_STORAGE_KEY) === 'lidl' ? 'lidl' : 'alphabetical'
  } catch {
    return 'alphabetical'
  }
}

export function FoodShoppingList() {
  const isMobile = useIsMobile()
  const { canEdit } = useAuth()
  const { data, isLoading } = useShopping()
  const check = useCheckShopping()
  const clear = useClearChecked()
  const clearAll = useClearShopping()
  const add = useAddShopping()
  const remove = useDeleteShopping()
  const [name, setName] = useState('')
  const [copied, setCopied] = useState(false)
  const [layout, setLayout] = useState<ShoppingLayout>(savedLayout)

  const items = data?.items ?? []
  const groups = layout === 'lidl' ? lidlShoppingGroups(items) : alphabeticalShoppingGroups(items)
  const total = data?.total ?? 0
  const done = data?.checkedCount ?? 0
  const doneLabel = done > 0 ? `Odhaczono ${done} z ${total}.` : `${total} do kupienia.`

  async function copyList() {
    await navigator.clipboard.writeText(shoppingListAsText(items, layout))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  function changeLayout(next: ShoppingLayout) {
    setLayout(next)
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, next)
    } catch {
      // The view still changes when browser storage is unavailable.
    }
  }

  return (
    <>
      <p style={{ fontSize: 14.5, color: 'var(--text-2)', margin: '0 0 22px' }}>
        Dodawaj ręcznie, z przepisów albo przez asystenta. {total > 0 && doneLabel}
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {canEdit && (
          <>
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
          </>
        )}
        {items.some((s) => !s.checked) && (
          <button
            onClick={copyList}
            style={{ border: '1px solid var(--border)', background: 'var(--card)', color: copied ? 'var(--sage)' : 'var(--text-2)', borderRadius: 11, padding: '10px 14px', cursor: 'pointer', font: "500 13px 'Hanken Grotesk'", whiteSpace: 'nowrap' }}
          >
            {copied ? '✓ Skopiowano' : 'Kopiuj listę'}
          </button>
        )}
        {canEdit && done > 0 && (
          <button
            onClick={() => clear.mutate()}
            style={{ border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text-2)', borderRadius: 11, padding: '10px 14px', cursor: 'pointer', font: "500 13px 'Hanken Grotesk'", whiteSpace: 'nowrap' }}
          >
            Usuń odhaczone
          </button>
        )}
        {canEdit && total > 0 && (
          <button
            onClick={() => {
              if (window.confirm(`Wyczyścić całą listę zakupów (pozycji: ${total})?`)) clearAll.mutate()
            }}
            style={{ border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--accent)', borderRadius: 11, padding: '10px 14px', cursor: 'pointer', font: "500 13px 'Hanken Grotesk'", whiteSpace: 'nowrap' }}
          >
            Wyczyść listę
          </button>
        )}
      </div>

      {items.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '-4px 0 12px' }}>
          <label htmlFor="shopping-layout" style={{ font: "600 11px 'Hanken Grotesk'", letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
            Układ listy
          </label>
          <select
            id="shopping-layout"
            value={layout}
            onChange={(event) => changeLayout(event.target.value as ShoppingLayout)}
            style={{ border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text-2)', borderRadius: 9, padding: '7px 10px', font: "500 12.5px 'Hanken Grotesk'", cursor: 'pointer' }}
          >
            <option value="alphabetical">Alfabetycznie</option>
            <option value="lidl">Alejki Lidl (orientacyjnie)</option>
          </select>
        </div>
      )}

      {isLoading ? (
        <div style={{ color: 'var(--text-3)', padding: 40 }}>Ładowanie…</div>
      ) : items.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 36, textAlign: 'center', color: 'var(--text-3)' }}>
          Lista jest pusta. Dodaj coś ręcznie albo z brakujących składników przepisu.
        </div>
      ) : (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          {groups.map((group) => (
            <div key={group.key}>
              {group.label && (
                <div style={{ padding: isMobile ? '11px 14px 8px' : '10px 17px 7px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', font: "650 11px 'Hanken Grotesk'", letterSpacing: '.08em', textTransform: 'uppercase', color: group.key === 'checked' ? 'var(--text-3)' : 'var(--sage)' }}>
                  {group.label}
                </div>
              )}
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
    </>
  )
}
