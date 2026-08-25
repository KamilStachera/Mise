import type { SupplyItem } from '../api/client'
import { SUPPLY_CATEGORIES, supplyCategoryLabel } from './labels'

export interface SupplyGroup {
  key: string
  label: string
  items: SupplyItem[]
}

function byPolishName(a: SupplyItem, b: SupplyItem): number {
  return a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' })
}

/**
 * Group by category in display order, checked items collected into a trailing group.
 * Deliberately separate from shoppingAisles.ts: those aisle rules are food-specific and
 * the two lists should not share a type.
 */
export function supplyGroups(items: SupplyItem[]): SupplyGroup[] {
  const unchecked = items.filter((item) => !item.checked)
  const groups: SupplyGroup[] = SUPPLY_CATEGORIES.map((category) => ({
    key: category,
    label: supplyCategoryLabel[category],
    items: unchecked.filter((item) => item.category === category).sort(byPolishName),
  })).filter((group) => group.items.length > 0)

  const checked = items.filter((item) => item.checked).sort(byPolishName)
  if (checked.length > 0) groups.push({ key: 'checked', label: 'Odhaczone', items: checked })
  return groups
}

/** Plain-text rendering for the clipboard — unchecked rows only. */
export function suppliesAsText(items: SupplyItem[]): string {
  return supplyGroups(items.filter((item) => !item.checked))
    .map((group) => `${group.label}\n${group.items.map((item) => `• ${item.name}`).join('\n')}`)
    .join('\n\n')
}
