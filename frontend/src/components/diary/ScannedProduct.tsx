import { useState, type CSSProperties } from 'react'
import type { BarcodeProduct, Slot } from '../../api/client'
import { useAddDiaryEntry, useFeminine } from '../../api/hooks'
import { formatKcal, slotTo } from '../../lib/labels'
import { showToast } from '../../lib/toastBus'
import { Button, Eyebrow, inputStyle, mono, sans } from '../ui'
import { PortionChip } from './RecipePicker'

const num = (s: string) => {
  const v = Number(s.replace(',', '.').trim())
  return s.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : null
}
const dec = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',')
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

/**
 * After a scan (P12 found / P13 not found): grams eaten → live kcal, logged as eaten and
 * remembered under the barcode as a per-100 g favourite (the next scan skips the lookup).
 */
export function ScannedProduct({ product, date, slot, onRescan, onDone }: {
  product: BarcodeProduct
  date: string
  slot: Slot
  onRescan: () => void
  onDone: () => void
}) {
  const add = useAddDiaryEntry()
  const serving = product.servingGrams
  const [grams, setGrams] = useState(dec(product.lastGrams ?? serving ?? 100))
  const [name, setName] = useState(product.name ?? '')
  const [kcal100, setKcal100] = useState(product.kcalPer100g != null ? String(product.kcalPer100g) : '')

  const g = num(grams)
  const k = num(kcal100)
  const total = g != null && k != null ? Math.round((k * g) / 100) : null
  const scale = (v: number | null) => (v == null || g == null ? null : Math.round((v * g) / 10) / 10)
  const canAdd = total != null && g! > 0 && name.trim().length > 0

  async function save() {
    if (!canAdd) return
    await add.mutateAsync({
      date,
      slot,
      title: name.trim(),
      kcal: total,
      protein: scale(product.protein),
      fat: scale(product.fat),
      carbs: scale(product.carbs),
      grams: g,
      eaten: true,
      favorite: { name: name.trim(), kcal: Math.round(k!), protein: product.protein, fat: product.fat, carbs: product.carbs, per100g: true, lastGrams: g, barcode: product.barcode },
    })
    showToast(`Dodano ${slotTo[slot]}: ${name.trim()} · ${total} kcal`)
    onDone()
  }

  const feminine = useFeminine()
  const label: CSSProperties = { font: mono(11, 500), letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-3)' }
  const chips = serving ? [[`1 porcja`, serving], [`2 porcje`, serving * 2]] as const : []

  const gramsBlock = (
    <>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={label}>{feminine ? 'Ile zjadłaś' : 'Ile zjadłeś'}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {chips.map(([l, v]) => (
              <PortionChip key={l} on={num(grams) === Math.round(v * 10) / 10} onClick={() => setGrams(dec(v))}>
                {l} <span style={{ font: mono(12), opacity: 0.7, marginLeft: 4 }}>{dec(v)} g</span>
              </PortionChip>
            ))}
          </div>
        </div>
      )}
      <span style={{ display: 'flex', alignItems: 'baseline', ...inputStyle, height: 64, padding: '0 16px' }}>
        <input
          value={grams}
          onChange={(e) => setGrams(e.target.value)}
          inputMode="decimal"
          aria-label="Gramy"
          style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', font: mono(28, 500), color: 'var(--text)', height: 62 }}
        />
        <span style={{ font: mono(13), color: 'var(--text-3)' }}>g</span>
      </span>
      {total != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
          <span style={{ font: mono(13), color: 'var(--text-2)' }}>{grams} g →</span>
          <span style={{ font: mono(30, 500) }}>{formatKcal(total)} <span style={{ font: mono(13), color: 'var(--text-3)' }}>kcal</span></span>
        </div>
      )}
    </>
  )

  if (!product.found) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Eyebrow>Kod {product.barcode}</Eyebrow>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 28 }}>Nie znaleziono</span>
        <p style={{ margin: 0, font: sans(15), lineHeight: 1.5, color: 'var(--text-2)', paddingBottom: 12, borderBottom: '1px solid var(--rule)' }}>
          {product.name ? `„${product.name}” jest w Open Food Facts, ale bez kalorii.` : 'Tego produktu nie ma jeszcze w Open Food Facts.'} Przepisz kcal z etykiety, a zapamiętam go pod tym kodem.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={label}>Nazwa</span>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Wafle ryżowe z czekoladą" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={label}>kcal / 100 g (z etykiety)</span>
          <input style={{ ...inputStyle, font: mono(16) }} value={kcal100} onChange={(e) => setKcal100(e.target.value)} inputMode="numeric" placeholder="478" />
        </label>
        {gramsBlock}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline" size="xl" onClick={onRescan}>Skanuj ponownie</Button>
          <Button size="xl" style={{ flex: 1 }} disabled={!canAdd || add.isPending} onClick={save}>Dodaj{total != null ? ` · ${formatKcal(total)} kcal` : ''}</Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ font: mono(11, 500), letterSpacing: '.1em', color: 'var(--sage-text)' }}>
          {product.source === 'favorite' ? 'Z TWOICH ULUBIONYCH' : 'ZNALEZIONO'} · {product.barcode}
        </span>
        <button type="button" onClick={onRescan} style={{ border: 0, background: 'transparent', padding: 0, font: sans(14, 600), color: 'var(--text)', cursor: 'pointer' }}>Skanuj inny</button>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <span style={{ width: 64, height: 64, flex: '0 0 64px', borderRadius: 10, background: 'var(--seg-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 22, color: 'var(--text-2)' }}>
          {initials(product.name ?? '?')}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 26, lineHeight: 1.1 }}>{product.name}</span>
          {(product.brand || product.servingLabel) && (
            <span style={{ font: sans(14), color: 'var(--text-2)' }}>{[product.brand, product.servingLabel].filter(Boolean).join(' · ')}</span>
          )}
          <span style={{ font: mono(13, 600) }}>{product.kcalPer100g} kcal / 100 g</span>
        </span>
      </div>
      {(product.protein != null || product.fat != null || product.carbs != null) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', font: mono(12.5), color: 'var(--text-2)', paddingBottom: 12, borderBottom: '1px solid var(--rule)' }}>
          <span>B {product.protein != null ? dec(product.protein) : '—'}  T {product.fat != null ? dec(product.fat) : '—'}  W {product.carbs != null ? dec(product.carbs) : '—'}</span>
          <span style={{ color: 'var(--text-3)' }}>na 100 g</span>
        </div>
      )}
      {gramsBlock}
      <span style={{ font: mono(11.5), color: 'var(--text-3)' }}>
        {product.source === 'favorite' ? 'twoje wartości' : 'dane: Open Food Facts'} · zapisze się w ulubionych
      </span>
      <Button size="xl" disabled={!canAdd || add.isPending} onClick={save}>
        Dodaj {slotTo[slot]}{total != null ? ` · ${formatKcal(total)} kcal` : ''}
      </Button>
    </div>
  )
}
