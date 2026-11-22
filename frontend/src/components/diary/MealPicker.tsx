import type { MealSlot, Slot } from '../../api/client'
import { Chip, Segmented } from '../ui'

/**
 * Picks one of the person's meals. Up to four fit a segmented control; a longer day (custom
 * meals) wraps into chips so names never get squeezed on a phone.
 */
export function MealPicker({ meals, value, onChange }: { meals: MealSlot[]; value: Slot; onChange: (key: Slot) => void }) {
  if (meals.length <= 4)
    return <Segmented value={value} onChange={onChange} items={meals.map((m) => ({ key: m.key, label: m.name }))} />
  return (
    <div role="radiogroup" aria-label="Posiłek" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {meals.map((m) => (
        <Chip key={m.key} active={m.key === value} onClick={() => onChange(m.key)}>{m.name}</Chip>
      ))}
    </div>
  )
}
