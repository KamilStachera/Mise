import type { PartnerPortionInput, Person } from '../../api/client'
import { usePerson } from '../../api/hooks'
import { formatPortion } from '../../lib/labels'
import { Chip, Toggle, mono } from '../ui'

const STORAGE_KEY = 'pichci.partner.portion.v1'
const PRESETS = [0.5, 1, 1.5, 2] as const

function readSavedMultipliers(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function saveMultiplier(personId: number, portions: number): void {
  try {
    const map = readSavedMultipliers()
    map[String(personId)] = portions
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore storage failures */
  }
}

function defaultPortionsFor(personId: number): number {
  const v = readSavedMultipliers()[String(personId)]
  return typeof v === 'number' && v >= 0.25 && v <= 10 ? v : 1
}

export function formatAlsoForToast(alsoFor: PartnerPortionInput[], people: Person[]): string {
  if (alsoFor.length === 0) return ''
  const names = alsoFor
    .map((a) => people.find((p) => p.id === a.personId)?.name)
    .filter((n): n is string => Boolean(n))
  return names.length > 0 ? ` (też dla: ${names.join(', ')})` : ''
}

/**
 * Couples sync control ("Gotujemy / jemy razem"): lets the active person also add a meal
 * or batch cook to one or more household partners with their own portion multiplier.
 * Renders nothing in single-person households.
 */
export function PartnerSyncToggle({
  value,
  onChange,
  labelPrefix = 'Dodaj też dla',
  showPortions = true,
}: {
  value: PartnerPortionInput[]
  onChange: (next: PartnerPortionInput[]) => void
  labelPrefix?: string
  showPortions?: boolean
}) {
  const { id: activePersonId, people } = usePerson()
  const others = people.filter((p) => p.id !== activePersonId)
  if (others.length === 0) return null

  const byId = new Map(value.map((item) => [item.personId, item]))

  function togglePartner(personId: number, on: boolean) {
    if (on) {
      const portions = defaultPortionsFor(personId)
      onChange([...value.filter((x) => x.personId !== personId), { personId, portions }])
    } else {
      onChange(value.filter((x) => x.personId !== personId))
    }
  }

  function setPartnerPortions(personId: number, portions: number) {
    saveMultiplier(personId, portions)
    onChange(value.map((x) => (x.personId === personId ? { ...x, portions } : x)))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
      {others.map((partner) => {
        const picked = byId.get(partner.id)
        return (
          <div key={partner.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Toggle
              on={Boolean(picked)}
              onChange={(on) => togglePartner(partner.id, on)}
              label={`${labelPrefix}: ${partner.name}`}
            />
            {picked && showPortions && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingBottom: 8 }}>
                <span style={{ font: mono(11.5), color: 'var(--text-3)', marginRight: 2 }}>Porcja:</span>
                {PRESETS.map((preset) => (
                  <Chip
                    key={preset}
                    active={picked.portions === preset}
                    onClick={() => setPartnerPortions(partner.id, preset)}
                    style={{ padding: '4px 10px', font: mono(12) }}
                  >
                    {formatPortion(preset)}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
