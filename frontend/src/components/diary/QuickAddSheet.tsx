import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { api, type BarcodeProduct, type RecipeListItem, type Slot } from '../../api/client'
import { useAddDiaryEntry, useDeletePlanEntry, useFoodFavorites, useLogFavorite } from '../../api/hooks'
import { DIARY_SLOTS, formatKcal, slotLabel, slotTo } from '../../lib/labels'
import { showToast } from '../../lib/toastBus'
import { Button, Chip, Eyebrow, Segmented, Sheet, Toggle, inputStyle, mono, sans } from '../ui'
import { BarcodeScanner, canScanBarcodes } from './BarcodeScanner'
import { RecipePicker } from './RecipePicker'
import { ScannedProduct } from './ScannedProduct'

const num = (s: string): number | null => {
  const v = Number(s.replace(',', '.').trim())
  return s.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : null
}

/**
 * „Szybki wpis” — log something eaten: a favourite chip (one tap + undo), a saved recipe
 * with a portion size, or typed name + kcal (per portion or per 100 g × grams).
 */
export function QuickAddSheet({ open, onClose, date, initialSlot }: {
  open: boolean
  onClose: () => void
  date: string
  initialSlot: Slot
}) {
  const [slot, setSlot] = useState<Slot>(initialSlot)
  const [view, setView] = useState<'main' | 'recipe' | 'code' | 'product'>('main')
  const [scanning, setScanning] = useState(false)
  const [code, setCode] = useState('')
  const [product, setProduct] = useState<BarcodeProduct | null>(null)
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const { data: favorites } = useFoodFavorites(open)
  const logFavorite = useLogFavorite()
  const add = useAddDiaryEntry()
  const del = useDeletePlanEntry()

  const [name, setName] = useState('')
  const [kcal, setKcal] = useState('')
  const [per100, setPer100] = useState(false)
  const [grams, setGrams] = useState('')
  const [protein, setProtein] = useState('')
  const [fat, setFat] = useState('')
  const [carbs, setCarbs] = useState('')
  const [remember, setRemember] = useState(true)
  const [recipe, setRecipe] = useState<RecipeListItem | null>(null)
  const [portions, setPortions] = useState(1)

  useEffect(() => {
    if (!open) return
    setSlot(initialSlot)
    setView('main')
    setScanning(false); setCode(''); setProduct(null); setLookupError(null)
    setName(''); setKcal(''); setPer100(false); setGrams(''); setProtein(''); setFat(''); setCarbs('')
    setRemember(true); setRecipe(null); setPortions(1)
  }, [open, initialSlot])

  const kcalValue = num(kcal)
  const gramsValue = num(grams)
  const factor = per100 ? (gramsValue ?? 0) / 100 : 1
  const total = kcalValue == null ? null : Math.round(kcalValue * factor)
  const scale = (s: string) => {
    const v = num(s)
    return v == null ? null : Math.round(v * factor * 10) / 10
  }
  const canTyped = name.trim().length > 0 && kcalValue != null && (!per100 || (gramsValue ?? 0) > 0)
  const recipeTotal = recipe?.kcal != null ? Math.round(recipe.kcal * portions) : null

  async function onChip(id: string, label: string, chipKcal: number) {
    const entry = await logFavorite.mutateAsync({ id, date, slot })
    onClose()
    showToast(`${label} · ${chipKcal} kcal ${slotTo[slot]}`, { label: 'Cofnij', run: () => del.mutate(entry.id) })
  }

  async function onAddTyped() {
    if (!canTyped) return
    await add.mutateAsync({
      date,
      slot,
      title: name.trim(),
      kcal: total,
      protein: scale(protein),
      fat: scale(fat),
      carbs: scale(carbs),
      grams: per100 ? gramsValue : null,
      eaten: true,
      favorite: remember
        ? { name: name.trim(), kcal: kcalValue!, protein: num(protein), fat: num(fat), carbs: num(carbs), per100g: per100, lastGrams: per100 ? gramsValue : null }
        : undefined,
    })
    showToast(`Dodano ${slotTo[slot]}: ${name.trim()}`)
    onClose()
  }

  async function onAddRecipe() {
    if (!recipe) return
    await add.mutateAsync({ date, slot, recipeId: recipe.id, portions, eaten: true })
    showToast(`Dodano ${slotTo[slot]}: ${recipe.title}`)
    onClose()
  }

  const label: CSSProperties = { font: mono(11, 500), letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-3)' }
  const busy = add.isPending || logFavorite.isPending

  async function lookup(c: string) {
    setLooking(true)
    setLookupError(null)
    try {
      setProduct(await api.barcode(c))
      setView('product')
    } catch {
      setLookupError('Nie udało się sprawdzić kodu. Spróbuj jeszcze raz.')
      setView('code')
    } finally {
      setLooking(false)
    }
  }

  // Stable identity: the scanner's camera effect restarts whenever onCode changes.
  const onCode = useCallback((c: string) => {
    setScanning(false)
    setCode(c)
    lookup(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const title = { main: 'Szybki wpis', recipe: 'Z przepisu', code: 'Wpisz kod', product: product?.found ? 'Produkt' : 'Szybki wpis' }[view]
  const startScan = () => (canScanBarcodes() ? setScanning(true) : setView('code'))

  return (
    <>
    {scanning && <BarcodeScanner onCode={onCode} onManual={() => { setScanning(false); setView('code') }} onClose={() => setScanning(false)} />}
    <Sheet open={open} onClose={onClose} title={title} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Segmented value={slot} onChange={setSlot} items={DIARY_SLOTS.map((s) => ({ key: s, label: slotLabel[s] }))} />

        {view === 'product' && product ? (
          <ScannedProduct product={product} date={date} slot={slot} onRescan={startScan} onDone={onClose} />
        ) : view === 'code' ? (
          <>
            <p style={{ margin: 0, font: sans(14.5), lineHeight: 1.5, color: 'var(--text-2)' }}>Cyfry spod kodu kreskowego (8–13 cyfr).</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              autoFocus
              aria-label="Kod kreskowy"
              placeholder="5901234123457"
              style={{ ...inputStyle, height: 64, font: mono(24, 500), letterSpacing: '.04em' }}
              onKeyDown={(e) => e.key === 'Enter' && code.length >= 8 && lookup(code)}
            />
            {lookupError && <span style={{ font: sans(13.5), color: 'var(--accent-text)' }}>{lookupError}</span>}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="quiet" size="xl" onClick={() => setView('main')}>‹</Button>
              <Button size="xl" style={{ flex: 1 }} disabled={code.length < 8 || looking} onClick={() => lookup(code)}>
                {looking ? 'Szukam…' : 'Szukaj produktu'}
              </Button>
            </div>
          </>
        ) : view === 'recipe' ? (
          <>
            <RecipePicker selected={recipe} onSelect={(r) => { setRecipe(r); setPortions(1) }} portions={portions} onPortions={setPortions} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="quiet" size="xl" onClick={() => setView('main')}>‹</Button>
              <Button size="xl" style={{ flex: 1 }} disabled={!recipe || busy} onClick={onAddRecipe}>
                Dodaj {slotTo[slot]}{recipeTotal != null ? ` · ${formatKcal(recipeTotal)} kcal` : ''}
              </Button>
            </div>
          </>
        ) : (
          <>
            {(favorites?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Eyebrow>Ulubione · jedno dotknięcie</Eyebrow>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {favorites!.map((f) => (
                    <Chip key={f.id} onClick={busy ? undefined : () => onChip(f.id, f.name, f.chipKcal)} style={{ padding: '10px 14px', font: sans(15, 500) }}>
                      {f.name}
                      <span style={{ font: mono(12.5), color: 'var(--text-3)' }}>{f.chipKcal}</span>
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Button variant="outline" size="xl" onClick={startScan}>Skanuj kod</Button>
              <Button variant="quiet" size="xl" onClick={() => setView('recipe')}>Z przepisu</Button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
              <Eyebrow>Albo wpisz sama</Eyebrow>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={label}>Nazwa</span>
                <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="np. pączek z różą" />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.7fr', gap: 12, alignItems: 'end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={label}>{per100 ? 'kcal / 100 g' : 'kcal'}</span>
                  <input style={{ ...inputStyle, font: mono(16) }} value={kcal} onChange={(e) => setKcal(e.target.value)} inputMode="numeric" placeholder="280" />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={label}>Liczone</span>
                  <Segmented value={per100 ? '100' : 'portion'} onChange={(k) => setPer100(k === '100')} items={[{ key: 'portion', label: 'na porcję' }, { key: '100', label: 'na 100 g' }]} />
                </div>
              </div>
              {per100 && (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={label}>Gramy</span>
                    <input style={{ ...inputStyle, font: mono(16) }} value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="decimal" placeholder="25" />
                  </label>
                  {total != null && gramsValue != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
                      <span style={{ font: mono(13), color: 'var(--text-2)' }}>{String(gramsValue).replace('.', ',')} g →</span>
                      <span style={{ font: mono(22, 500) }}>{formatKcal(total)} kcal</span>
                    </div>
                  )}
                </>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {([['B · g', protein, setProtein], ['T · g', fat, setFat], ['W · g', carbs, setCarbs]] as const).map(([l, v, set]) => (
                  <label key={l} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={label}>{l}</span>
                    <input style={{ ...inputStyle, font: mono(15) }} value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" placeholder="—" />
                  </label>
                ))}
              </div>
              <Toggle on={remember} onChange={setRemember} label="Zapamiętaj jako ulubione" />
              <Button size="xl" disabled={!canTyped || busy} onClick={onAddTyped}>
                Dodaj {slotTo[slot]}{total != null ? ` · ${formatKcal(total)} kcal` : ''}
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
    </>
  )
}
