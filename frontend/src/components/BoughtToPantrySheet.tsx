import { useEffect, useMemo, useState } from 'react'
import { errorText, type PantryAdjustItem, type PantryItem, type ShoppingItem, type Unit } from '../api/client'
import { useAdjustPantry, useClearChecked, usePantry } from '../api/hooks'
import { plural, unitLabel } from '../lib/labels'
import { showToast } from '../lib/toastBus'
import { Button, Sheet, Toggle, inputStyle, mono, sans } from './ui'

interface DraftRow {
  shoppingId: string
  shoppingName: string
  include: boolean
  pantryItemId: string
  quantity: string
  unit: Unit
}

function parsePositive(raw: string): number | null {
  const v = Number(raw.replace(',', '.').trim())
  return raw.trim() !== '' && Number.isFinite(v) && v > 0 ? v : null
}

function findInitialMatch(item: ShoppingItem, pantry: PantryItem[]): PantryItem | null {
  if (item.pantryItemId) {
    const direct = pantry.find((p) => p.id === item.pantryItemId)
    if (direct) return direct
  }
  const needle = item.name.trim().toLowerCase()
  return (
    pantry.find((p) => p.name.trim().toLowerCase() === needle) ??
    pantry.find((p) => p.aliases.some((a) => a.trim().toLowerCase() === needle)) ??
    null
  )
}

function defaultQty(item: ShoppingItem, match: PantryItem | null): string {
  if (!match) return ''
  if (item.quantity != null && item.quantity > 0 && item.unit === match.unit) {
    return String(Math.round(item.quantity * 100) / 100).replace('.', ',')
  }
  return match.unit === 'szt' ? '1' : ''
}

/**
 * Opt-in post-shopping review: maps checked shopping rows to existing pantry items and
 * sends one POST /pantry/adjust delta. Never runs automatically and never creates new catalog rows.
 */
export function BoughtToPantrySheet({
  open,
  onClose,
  checkedItems,
}: {
  open: boolean
  onClose: () => void
  checkedItems: ShoppingItem[]
}) {
  const { data: groups } = usePantry()
  const adjust = useAdjustPantry()
  const clearChecked = useClearChecked()

  const pantry = useMemo(
    () => (groups ?? []).flatMap((g) => g.items).sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    [groups],
  )
  const pantryById = useMemo(() => new Map(pantry.map((p) => [p.id, p])), [pantry])

  const [rows, setRows] = useState<DraftRow[]>([])
  const [removeChecked, setRemoveChecked] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setRemoveChecked(true)
    setRows(
      checkedItems.map((item) => {
        const match = findInitialMatch(item, pantry)
        return {
          shoppingId: item.id,
          shoppingName: item.name,
          include: match != null,
          pantryItemId: match?.id ?? '',
          quantity: defaultQty(item, match),
          unit: match?.unit ?? item.unit ?? 'szt',
        }
      }),
    )
    // Re-seed whenever the sheet opens or the pantry catalog arrives.
  }, [open, checkedItems, pantry])

  function updateRow(shoppingId: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => (r.shoppingId === shoppingId ? { ...r, ...patch } : r)))
  }

  function changePantry(shoppingId: string, nextId: string) {
    const match = nextId ? pantryById.get(nextId) ?? null : null
    setRows((prev) =>
      prev.map((r) => {
        if (r.shoppingId !== shoppingId) return r
        if (!match) return { ...r, pantryItemId: '', include: false }
        const qty = r.quantity.trim() || (match.unit === 'szt' ? '1' : '')
        return { ...r, pantryItemId: match.id, unit: match.unit, include: true, quantity: qty }
      }),
    )
  }

  const readyRows = rows.filter((r) => r.include && r.pantryItemId && parsePositive(r.quantity) != null)
  const missingQtyCount = rows.filter((r) => r.include && r.pantryItemId && parsePositive(r.quantity) == null).length
  const busy = adjust.isPending || clearChecked.isPending

  async function submit() {
    if (readyRows.length === 0) return
    setError(null)
    const items: PantryAdjustItem[] = readyRows.map((r) => ({
      name: r.shoppingName,
      quantity: parsePositive(r.quantity)!,
      unit: r.unit,
      pantryItemId: r.pantryItemId,
    }))
    try {
      const res = await adjust.mutateAsync({ items })
      if (removeChecked) {
        await clearChecked.mutateAsync()
      }
      const updated = res.updated.length
      const skipped = res.notInCatalog.length
      showToast(
        skipped > 0
          ? `Dopisano do spiżarni: ${plural(updated, 'produkt', 'produkty', 'produktów')} (pominięto: ${skipped}).`
          : `Dopisano do spiżarni: ${plural(updated, 'produkt', 'produkty', 'produktów')}.`,
      )
      onClose()
    } catch (err) {
      setError(errorText(err, 'Nie udało się dopisać do spiżarni.'))
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Dopisz kupione do spiżarni" width={600}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, font: sans(14), lineHeight: 1.5, color: 'var(--text-2)' }}>
          Zaznacz produkty, które mają trafić na stan spiżarni i wpisz kupioną ilość. Wartości dodadzą się do obecnego stanu.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((row) => {
            const qtyMissing = row.include && row.pantryItemId !== '' && parsePositive(row.quantity) == null
            const matched = row.pantryItemId ? pantryById.get(row.pantryItemId) : null
            return (
              <div
                key={row.shoppingId}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: '12px 0',
                  borderBottom: '1px solid var(--border)',
                  opacity: row.include ? 1 : 0.6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={row.include}
                    disabled={!row.pantryItemId}
                    onChange={(e) => updateRow(row.shoppingId, { include: e.target.checked })}
                    aria-label={`Dopisz ${row.shoppingName}`}
                    style={{ width: 18, height: 18, accentColor: 'var(--sage)', cursor: row.pantryItemId ? 'pointer' : 'not-allowed' }}
                  />
                  <span style={{ flex: 1, minWidth: 0, font: sans(15, 600) }}>{row.shoppingName}</span>
                  {matched && (
                    <span style={{ font: mono(11.5), color: 'var(--text-3)' }}>
                      teraz: {String(matched.quantity).replace('.', ',')} {unitLabel[matched.unit]}
                    </span>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 128px', gap: 8, paddingLeft: 28 }}>
                  <select
                    value={row.pantryItemId}
                    onChange={(e) => changePantry(row.shoppingId, e.target.value)}
                    aria-label={`Produkt w spiżarni dla ${row.shoppingName}`}
                    style={{ ...inputStyle, height: 40, padding: '0 10px', font: sans(13.5) }}
                  >
                    <option value="">— pomiń (nie ma w katalogu) —</option>
                    {pantry.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({unitLabel[p.unit]})
                      </option>
                    ))}
                  </select>

                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      ...inputStyle,
                      height: 40,
                      padding: '0 10px',
                      borderColor: qtyMissing ? 'var(--accent)' : 'var(--border-2)',
                    }}
                  >
                    <input
                      value={row.quantity}
                      disabled={!row.pantryItemId}
                      onChange={(e) => updateRow(row.shoppingId, { quantity: e.target.value, include: true })}
                      inputMode="decimal"
                      placeholder={row.unit === 'szt' ? '1' : 'np. 500'}
                      aria-label={`Ilość dla ${row.shoppingName}`}
                      style={{
                        width: '100%',
                        border: 0,
                        background: 'transparent',
                        textAlign: 'right',
                        font: mono(14.5, 500),
                        color: 'var(--text)',
                        outline: 'none',
                      }}
                    />
                    <span style={{ font: mono(12), color: 'var(--text-3)', flexShrink: 0 }}>{unitLabel[row.unit]}</span>
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {missingQtyCount > 0 && (
          <span style={{ font: sans(13), color: 'var(--accent-text)' }}>
            Uzupełnij ilość dla {plural(missingQtyCount, 'zaznaczonej pozycji', 'zaznaczonych pozycji', 'zaznaczonych pozycji')} albo odznacz, jeśli chcesz ją pominąć.
          </span>
        )}

        <Toggle
          on={removeChecked}
          onChange={setRemoveChecked}
          label="Usuń odhaczone z listy zakupów po dopisaniu"
        />

        {error && <span style={{ font: sans(13.5), color: 'var(--accent-text)' }}>{error}</span>}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="quiet" size="xl" onClick={onClose} disabled={busy}>Anuluj</Button>
          <Button
            size="xl"
            style={{ flex: 1 }}
            disabled={busy || readyRows.length === 0 || missingQtyCount > 0}
            onClick={submit}
          >
            {busy ? 'Dopisuję…' : `Dopisz do spiżarni (${readyRows.length})`}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
