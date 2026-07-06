import { useState, type CSSProperties } from 'react'
import { usePantry, useAddPantry, useUpdatePantry, useDeletePantry } from '../api/hooks'
import type { PantryItem, Status, Unit } from '../api/client'
import { statusColor, statusLabel, categoryLabel, formatQty, unitLabel, UNITS } from '../lib/labels'
import { PlusIcon } from '../components/icons'

function pill(s: Status): CSSProperties {
  return {
    font: "600 10.5px 'Hanken Grotesk'",
    letterSpacing: '.04em',
    textTransform: 'uppercase',
    padding: '3px 9px',
    borderRadius: 7,
    background: s === 'in' ? 'rgba(110,122,82,.14)' : s === 'low' ? 'rgba(189,139,44,.16)' : 'var(--accent-soft)',
    color: statusColor(s),
  }
}

const CATS = ['Produce', 'Fridge', 'Pantry', 'Spices']

const inputStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--card)',
  borderRadius: 9,
  padding: '9px 12px',
  font: "400 14px 'Hanken Grotesk'",
  color: 'var(--text)',
}

/** Parse a user-typed amount ("1,5" or "1.5"); NaN-safe. */
function parseAmount(s: string): number | null {
  if (!s.trim()) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function Pantry() {
  const { data: groups = [], isLoading } = usePantry()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [cat, setCat] = useState('Produce')
  const [unit, setUnit] = useState<Unit>('szt')
  const [startQty, setStartQty] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const add = useAddPantry()

  async function submitAdd() {
    if (!name.trim()) return
    try {
      await add.mutateAsync({
        name: name.trim(),
        category: cat,
        unit,
        quantity: parseAmount(startQty) ?? 0,
      })
      setName('')
      setStartQty('')
      setAdding(false)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('409')) {
        alert('Taki produkt już jest w katalogu — znajdź go na liście i zmień ilość.')
      } else {
        alert('Nie udało się dodać produktu.')
      }
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '38px 42px 60px' }}>
      <div style={{ font: "600 11px 'Hanken Grotesk'", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 7 }}>
        W Twojej kuchni
      </div>
      <h1 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 38, margin: '0 0 5px' }}>Moja spiżarnia</h1>
      <p style={{ fontSize: 14.5, color: 'var(--text-2)', margin: '0 0 8px' }}>
        Kliknij produkt, aby zmienić ilość. Zakupy najlepiej wprowadza asystent ze zdjęcia paragonu.
      </p>

      <div style={{ display: 'flex', gap: 18, margin: '18px 0 28px', font: "500 13px 'Hanken Grotesk'", color: 'var(--text-2)', alignItems: 'center' }}>
        <Legend c="var(--sage)" t="Jest" />
        <Legend c="var(--gold)" t="Mało" />
        <Legend c="var(--accent)" t="Brak" />
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setAdding((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', borderRadius: 9, padding: '7px 12px', cursor: 'pointer', font: "500 13px 'Hanken Grotesk'" }}
        >
          <PlusIcon size={14} /> Dodaj produkt
        </button>
      </div>

      {adding && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 22, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
            placeholder="Nazwa produktu…"
            style={{ ...inputStyle, flex: '1 1 180px' }}
          />
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={inputStyle}>
            {CATS.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} style={inputStyle}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {unitLabel[u]}
              </option>
            ))}
          </select>
          <input
            value={startQty}
            onChange={(e) => setStartQty(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
            placeholder="Ilość (0)"
            inputMode="decimal"
            style={{ ...inputStyle, width: 80 }}
          />
          <button onClick={submitAdd} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', cursor: 'pointer', font: "600 13.5px 'Hanken Grotesk'" }}>
            Dodaj
          </button>
        </div>
      )}

      {isLoading ? (
        <div style={{ color: 'var(--text-3)', padding: 40 }}>Ładowanie…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          {groups.map((g) => (
            <div key={g.category}>
              <h2 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 17, margin: '0 0 11px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 9 }}>
                {categoryLabel(g.category)} <span style={{ font: "500 11px 'Hanken Grotesk'", color: 'var(--text-3)' }}>{g.items.length} produktów</span>
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 9, alignItems: 'start' }}>
                {g.items.map((it) => (
                  <ItemCard
                    key={it.id}
                    item={it}
                    editing={editingId === it.id}
                    onToggle={() => setEditingId(editingId === it.id ? null : it.id)}
                    onClose={() => setEditingId(null)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ItemCard({ item, editing, onToggle, onClose }: {
  item: PantryItem
  editing: boolean
  onToggle: () => void
  onClose: () => void
}) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', background: 'transparent', border: 'none', padding: '11px 13px', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ flex: '0 0 9px', width: 9, height: 9, borderRadius: '50%', background: statusColor(item.status) }} />
        <span style={{ flex: 1, font: "500 14px 'Hanken Grotesk'", color: 'var(--text)' }}>{item.name}</span>
        <span style={{ font: "500 12.5px 'Spline Sans Mono'", color: item.quantity > 0 ? 'var(--text-2)' : 'var(--text-3)' }}>
          {formatQty(item.quantity, item.unit)}
        </span>
        <span style={pill(item.status)}>{statusLabel[item.status] ?? item.status}</span>
      </button>
      {editing && <ItemEditor item={item} onClose={onClose} />}
    </div>
  )
}

function ItemEditor({ item, onClose }: { item: PantryItem; onClose: () => void }) {
  const update = useUpdatePantry()
  const remove = useDeletePantry()
  const [qty, setQty] = useState(String(item.quantity).replace('.', ','))
  const [threshold, setThreshold] = useState(item.lowThreshold != null ? String(item.lowThreshold).replace('.', ',') : '')
  const step = item.unit === 'szt' ? 1 : 50

  function bump(delta: number) {
    const current = parseAmount(qty) ?? 0
    setQty(String(Math.max(0, current + delta)).replace('.', ','))
  }

  async function save() {
    await update.mutateAsync({
      id: item.id,
      input: {
        name: item.name,
        category: item.category,
        unit: item.unit,
        quantity: Math.max(0, parseAmount(qty) ?? 0),
        lowThreshold: parseAmount(threshold),
        aliases: item.aliases,
      },
    })
    onClose()
  }

  async function del() {
    if (!confirm(`Usunąć „${item.name}" z katalogu spiżarni? Zwykle lepiej wyzerować ilość.`)) return
    await remove.mutateAsync(item.id)
    onClose()
  }

  const smallBtn: CSSProperties = {
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    borderRadius: 8,
    padding: '7px 11px',
    cursor: 'pointer',
    font: "600 13px 'Hanken Grotesk'",
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <button onClick={() => bump(-step)} style={smallBtn}>−{step}</button>
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          inputMode="decimal"
          style={{ width: 74, textAlign: 'center', border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, padding: '7px 8px', font: "500 13.5px 'Spline Sans Mono'", color: 'var(--text)' }}
        />
        <span style={{ font: "500 12.5px 'Hanken Grotesk'", color: 'var(--text-3)', width: 28 }}>{unitLabel[item.unit]}</span>
        <button onClick={() => bump(step)} style={smallBtn}>+{step}</button>
        <button onClick={() => setQty('0')} style={{ ...smallBtn, color: 'var(--text-2)' }}>Wyzeruj</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ font: "500 12px 'Hanken Grotesk'", color: 'var(--text-3)' }}>Próg „mało”:</span>
        <input
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          placeholder="brak"
          inputMode="decimal"
          style={{ width: 64, textAlign: 'center', border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, padding: '6px 8px', font: "500 12.5px 'Spline Sans Mono'", color: 'var(--text)' }}
        />
        <div style={{ flex: 1 }} />
        <button onClick={del} style={{ ...smallBtn, color: 'var(--accent)', borderColor: 'var(--accent-soft)' }}>
          Usuń
        </button>
        <button onClick={onClose} style={{ ...smallBtn, color: 'var(--text-2)' }}>Anuluj</button>
        <button onClick={save} disabled={update.isPending} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 15px', cursor: 'pointer', font: "600 13px 'Hanken Grotesk'" }}>
          Zapisz
        </button>
      </div>
    </div>
  )
}

function Legend({ c, t }: { c: string; t: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: c }} />
      {t}
    </span>
  )
}
