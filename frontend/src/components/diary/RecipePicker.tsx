import { useState, type ReactNode } from 'react'
import type { RecipeListItem } from '../../api/client'
import { useRecipes } from '../../api/hooks'
import { formatKcal, formatPortion } from '../../lib/labels'
import { RecipeThumb } from '../RecipeThumb'
import { Eyebrow, inputStyle, mono, sans } from '../ui'
import { KcalMissingTag } from './parts'

export const PORTION_CHOICES = [0.5, 1, 1.5]

/**
 * Search saved recipes; the selected one expands into portion chips with the live kcal
 * (P15 "Z przepisu"). `portions` is null when the caller does not ask for a portion size.
 */
export function RecipePicker({ selected, onSelect, portions, onPortions }: {
  selected: RecipeListItem | null
  onSelect: (r: RecipeListItem | null) => void
  portions?: number
  onPortions?: (p: number) => void
}) {
  const { data: recipes } = useRecipes('all', '')
  const [filter, setFilter] = useState('')
  const [custom, setCustom] = useState(false)
  const [customText, setCustomText] = useState('2')

  const q = filter.trim().toLocaleLowerCase('pl-PL')
  const matches = (recipes ?? [])
    .filter((r) => !q || r.title.toLocaleLowerCase('pl-PL').includes(q))
    .slice(0, q ? 12 : 8)

  const pickCustom = (text: string) => {
    setCustomText(text)
    const v = Number(text.replace(',', '.'))
    if (onPortions && Number.isFinite(v) && v > 0 && v <= 10) onPortions(v)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input
        style={inputStyle}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Szukaj przepisu…"
        autoFocus
      />
      <Eyebrow>Twoje przepisy · {matches.length}</Eyebrow>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {matches.map((r) => {
          const on = selected?.id === r.id
          return (
            <div key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => onSelect(on ? null : r)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 0', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
              >
                <RecipeThumb r={r} letterSize={18} style={{ width: 48, height: 48, borderRadius: 10 }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 18, lineHeight: 1.2 }}>{r.title}</span>
                  {r.kcal != null ? <span style={{ font: mono(12), color: 'var(--text-3)' }}>{r.kcal} kcal / porcja</span> : <span><KcalMissingTag /></span>}
                </span>
                <span style={{ color: 'var(--text-3)' }}>{on ? '✓' : '›'}</span>
              </button>
              {on && onPortions && portions != null && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, marginBottom: 10, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                  <Eyebrow>Porcja</Eyebrow>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {PORTION_CHOICES.map((p) => (
                      <PortionChip key={p} on={!custom && portions === p} onClick={() => { setCustom(false); onPortions(p) }}>
                        {formatPortion(p)}
                      </PortionChip>
                    ))}
                    <PortionChip on={custom} onClick={() => { setCustom(true); pickCustom(customText) }}>inna</PortionChip>
                    {custom && (
                      <input
                        value={customText}
                        onChange={(e) => pickCustom(e.target.value)}
                        inputMode="decimal"
                        aria-label="Porcje"
                        style={{ ...inputStyle, width: 72, height: 44, font: mono(15) }}
                      />
                    )}
                  </div>
                  {r.kcal != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ font: mono(12.5), color: 'var(--text-3)' }}>{String(portions).replace('.', ',')} × {r.kcal}</span>
                      <span style={{ font: mono(22, 500) }}>{formatKcal(r.kcal * portions)} kcal</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {matches.length === 0 && <span style={{ font: sans(13.5), color: 'var(--text-3)', padding: '8px 0' }}>Brak pasujących przepisów.</span>}
      </div>
    </div>
  )
}

export function PortionChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ height: 44, minWidth: 58, padding: '0 14px', borderRadius: 999, border: on ? 0 : '1px solid var(--border)', background: on ? 'var(--text)' : 'transparent', color: on ? 'var(--bg)' : 'var(--text)', font: sans(14, 600), cursor: 'pointer' }}
    >
      {children}
    </button>
  )
}
