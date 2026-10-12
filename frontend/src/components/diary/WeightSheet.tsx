import { useEffect, useState } from 'react'
import { useSetWeight } from '../../api/hooks'
import { addDays, toISO } from '../../lib/dates'
import { showToast } from '../../lib/toastBus'
import { Button, Segmented, Sheet, mono, sans } from '../ui'

const fmt = (kg: number) => kg.toFixed(1).replace('.', ',')

/** „Dodaj wagę” (P17): one big number, ±0,1 steps, today or yesterday. Same day = replaces. */
export function WeightSheet({ open, onClose, lastKg, trendKg }: {
  open: boolean
  onClose: () => void
  lastKg: number | null
  trendKg: number | null
}) {
  const setWeight = useSetWeight()
  const [text, setText] = useState('')
  const [when, setWhen] = useState<'today' | 'yesterday'>('today')

  useEffect(() => {
    if (open) {
      setText(lastKg != null ? fmt(lastKg) : '')
      setWhen('today')
    }
  }, [open, lastKg])

  const kg = Number(text.replace(',', '.'))
  const valid = text.trim() !== '' && Number.isFinite(kg) && kg >= 25 && kg <= 350
  const bump = (d: number) => setText(fmt(Math.round(((valid ? kg : lastKg ?? 60) + d) * 10) / 10))

  async function save() {
    const date = toISO(when === 'today' ? new Date() : addDays(new Date(), -1))
    await setWeight.mutateAsync({ date, kg: Math.round(kg * 10) / 10 })
    showToast(`Zapisano wagę: ${fmt(kg)} kg`)
    onClose()
  }

  const step = { width: 52, height: 52, borderRadius: '50%', border: '1px solid var(--rule)', background: 'transparent', font: sans(15, 600), color: 'var(--text)', cursor: 'pointer' } as const

  return (
    <Sheet open={open} onClose={onClose} title="Dodaj wagę" width={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Segmented value={when} onChange={setWhen} items={[{ key: 'today', label: 'Dziś rano' }, { key: 'yesterday', label: 'Wczoraj' }]} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
          <button type="button" aria-label="Minus 0,1 kg" onClick={() => bump(-0.1)} style={step}>−0,1</button>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              inputMode="decimal"
              aria-label="Waga w kg"
              autoFocus
              style={{ width: 180, border: 0, background: 'transparent', textAlign: 'center', font: mono(64, 500), letterSpacing: '-0.04em', color: 'var(--text)' }}
            />
            <span style={{ font: mono(16), color: 'var(--text-3)' }}>kg</span>
          </span>
          <button type="button" aria-label="Plus 0,1 kg" onClick={() => bump(0.1)} style={step}>+0,1</button>
        </div>
        {(lastKg != null || trendKg != null) && (
          <span style={{ font: mono(12.5), color: 'var(--text-2)', textAlign: 'center' }}>
            {lastKg != null && `ostatnio ${fmt(lastKg)}`}{lastKg != null && trendKg != null && ' · '}{trendKg != null && `trend ${fmt(trendKg)}`}
          </span>
        )}
        <span style={{ font: sans(13.5), lineHeight: 1.5, color: 'var(--text-2)' }}>
          Waż się rano, po toalecie, przed jedzeniem. Pojedynczy wynik skacze — liczy się trend.
        </span>
        <Button size="xl" disabled={!valid || setWeight.isPending} onClick={save}>
          {setWeight.isPending ? 'Zapisywanie…' : 'Zapisz wagę'}
        </Button>
      </div>
    </Sheet>
  )
}
