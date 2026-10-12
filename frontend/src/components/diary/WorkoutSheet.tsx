import { useEffect, useState, type CSSProperties } from 'react'
import { useAddWorkout } from '../../api/hooks'
import { addDays, toISO } from '../../lib/dates'
import { formatKcal } from '../../lib/labels'
import { showToast } from '../../lib/toastBus'
import { Button, Chip, Segmented, Sheet, inputStyle, mono, sans } from '../ui'

/** Rough MET values; active kcal ≈ (MET − 1) × kg × hours (the resting part is already in BMR). */
const TYPES: [string, number][] = [
  ['Trening siłowy', 5], ['Spacer', 3.5], ['Rower', 7], ['Bieganie', 9], ['Joga', 2.5], ['Basen', 7], ['Inny', 5],
]

/** „Dodaj trening” (P22): type, minutes, kcal (with an estimate), when; shows the budget effect. */
export function WorkoutSheet({ open, onClose, weightKg, addBackPercent }: {
  open: boolean
  onClose: () => void
  weightKg: number | null
  addBackPercent: number
}) {
  const add = useAddWorkout()
  const [type, setType] = useState('Spacer')
  const [minutes, setMinutes] = useState('40')
  const [kcal, setKcal] = useState('')
  const [when, setWhen] = useState<'today' | 'yesterday'>('today')
  const [time, setTime] = useState('')

  useEffect(() => {
    if (!open) return
    setType('Spacer'); setMinutes('40'); setKcal(''); setWhen('today')
    const now = new Date()
    setTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
  }, [open])

  const min = Number(minutes)
  const met = TYPES.find(([t]) => t === type)?.[1] ?? 5
  const estimate = weightKg && min > 0 ? Math.round(((met - 1) * weightKg * min) / 60 / 10) * 10 : null
  const kcalValue = kcal.trim() === '' ? estimate : Number(kcal)
  const valid = min > 0 && min <= 600 && kcalValue != null && Number.isFinite(kcalValue) && kcalValue >= 0
  const bonus = kcalValue != null ? Math.round((kcalValue * addBackPercent) / 100) : 0

  async function save() {
    if (!valid) return
    await add.mutateAsync({
      date: toISO(when === 'today' ? new Date() : addDays(new Date(), -1)),
      type,
      minutes: min,
      kcal: Math.round(kcalValue!),
      time: time || undefined,
    })
    showToast(`Dodano trening: ${type} · ${Math.round(kcalValue!)} kcal`)
    onClose()
  }

  const label: CSSProperties = { font: mono(11, 500), letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-3)' }
  const unitField = (value: string, onChange: (v: string) => void, unit: string, placeholder?: string) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, ...inputStyle, padding: '0 14px' }}>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="numeric" placeholder={placeholder} style={{ flex: 1, minWidth: 0, width: '100%', border: 0, background: 'transparent', font: mono(16), color: 'var(--text)', height: 44 }} />
      <span style={{ font: mono(12), color: 'var(--text-3)' }}>{unit}</span>
    </span>
  )

  return (
    <Sheet open={open} onClose={onClose} title="Dodaj trening" width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={label}>Rodzaj</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {TYPES.map(([t]) => <Chip key={t} active={type === t} onClick={() => setType(t)} style={{ padding: '10px 14px', font: sans(14.5, 500) }}>{t}</Chip>)}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={label}>Minuty</span>{unitField(minutes, setMinutes, 'min')}</label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={label}>Spalone</span>{unitField(kcal, setKcal, 'kcal', estimate != null ? String(estimate) : '')}</label>
        </div>
        {estimate != null && kcal.trim() === '' && (
          <span style={{ font: sans(13.5), color: 'var(--text-2)' }}>Nie wiesz? Liczę z czasu i wagi: <span style={{ font: mono(13, 500) }}>~{estimate} kcal</span></span>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={label}>Kiedy</span>
            <Segmented value={when} onChange={setWhen} items={[{ key: 'today', label: 'Dziś' }, { key: 'yesterday', label: 'Wczoraj' }]} />
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={label}>Godzina</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inputStyle, font: mono(15) }} />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '1px solid var(--rule)', font: sans(15) }}>
          <span>Do budżetu ({addBackPercent} %)</span>
          <span style={{ font: mono(15, 500) }}>+{formatKcal(bonus)} kcal</span>
        </div>
        <Button size="xl" disabled={!valid || add.isPending} onClick={save}>{add.isPending ? 'Zapisywanie…' : 'Dodaj trening'}</Button>
      </div>
    </Sheet>
  )
}
