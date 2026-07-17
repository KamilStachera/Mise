/**
 * Returns the recipe-specific clarification shown below the canonical pantry
 * name. When the raw line begins with the separately rendered quantity, strip
 * that prefix so the amount is not displayed twice.
 */
export function ingredientDetailText(
  displayText: string | null | undefined,
  quantity: string | null | undefined,
): string | null {
  const detail = displayText?.trim()
  if (!detail) return null

  const amount = quantity?.trim()
  if (!amount || !detail.toLocaleLowerCase('pl-PL').startsWith(amount.toLocaleLowerCase('pl-PL'))) {
    return detail
  }

  const withoutAmount = detail.slice(amount.length).replace(/^\s*[-–—,:]\s*/, '').trim()
  return withoutAmount || null
}
