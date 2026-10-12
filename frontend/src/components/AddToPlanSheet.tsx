import { CookSplitSheet } from './diary/CookSplitSheet'

/**
 * "Dodaj do planu" from a recipe: pick the cook day and slot, how many portions the pot makes
 * and which further days eat them (the leftovers are bought once, on the cook day). One
 * portion and no extra days is a plain plan entry.
 */
export function AddToPlanSheet({ open, onClose, recipe }: {
  open: boolean
  onClose: () => void
  recipe: { id: string; title: string; kcal: number | null; servings: number; selectedServings?: number }
}) {
  if (!open) return null
  return (
    <CookSplitSheet
      open
      onClose={onClose}
      title="Dodaj do planu"
      recipe={{ id: recipe.id, title: recipe.title, kcal: recipe.kcal, servings: recipe.selectedServings ?? recipe.servings }}
      origin={{ kind: 'new' }}
    />
  )
}
