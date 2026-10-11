import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useShopping, useCheckShopping, useClearChecked, useClearShopping, useAddShopping, useDeleteShopping } from '../api/hooks'
import type { ShoppingItem, ShoppingRecipeRef } from '../api/client'
import { formatQty } from '../lib/labels'
import { alphabeticalShoppingGroups, lidlShoppingGroups, shoppingListAsText, type ShoppingLayout } from '../lib/shoppingAisles'
import { showToast } from '../lib/toastBus'
import { AddBar, CheckGroup, CheckRow, Progress, ShoppingFrame, useShoppingCounts, type ListAction } from './ShoppingFrame'
import { RecipeThumb } from './RecipeThumb'
import { mono, sans } from './ui'

const LAYOUT_STORAGE_KEY = 'pichci.shopping.layout'

function savedLayout(): ShoppingLayout {
  try {
    return localStorage.getItem(LAYOUT_STORAGE_KEY) === 'lidl' ? 'lidl' : 'alphabetical'
  } catch {
    return 'alphabetical'
  }
}

/** Second line under a row: the recipes it is for, else the free-text reason. */
function rowSub(s: ShoppingItem): string | null {
  if (s.recipes.length > 0) return s.recipes.map((r) => r.title).join(', ')
  return s.reason?.replace(/^Do:\s*/, '') || null
}

export function FoodShoppingList() {
  const nav = useNavigate()
  const { canEdit } = useAuth()
  const { data, isLoading } = useShopping()
  const counts = useShoppingCounts()
  const check = useCheckShopping()
  const clear = useClearChecked()
  const clearAll = useClearShopping()
  const add = useAddShopping()
  const remove = useDeleteShopping()
  const [name, setName] = useState('')
  const [layout, setLayout] = useState<ShoppingLayout>(savedLayout)

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const done = data?.checkedCount ?? 0
  const unchecked = items.filter((s) => !s.checked)
  const checked = items.filter((s) => s.checked)
  const groups = layout === 'lidl' ? lidlShoppingGroups(unchecked) : alphabeticalShoppingGroups(unchecked)

  // "Dla przepisów": which recipes the open rows serve, with how many rows each.
  const forRecipes = useMemo(() => {
    const map = new Map<string, { recipe: ShoppingRecipeRef; count: number }>()
    for (const s of unchecked)
      for (const r of s.recipes) map.set(r.id, { recipe: r, count: (map.get(r.id)?.count ?? 0) + 1 })
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [unchecked])

  function submit() {
    if (!name.trim()) return
    add.mutate({ name: name.trim() })
    setName('')
  }

  async function copyList() {
    try {
      await navigator.clipboard.writeText(shoppingListAsText(items, layout))
      showToast('Skopiowano listę do schowka.')
    } catch {
      showToast('Nie udało się skopiować listy.')
    }
  }

  function changeLayout(next: ShoppingLayout) {
    setLayout(next)
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, next)
    } catch {
      // The view still changes when browser storage is unavailable.
    }
  }

  const actions: ListAction[] = [
    ...(unchecked.length > 0 ? [{ label: 'Kopiuj listę', onClick: copyList }] : []),
    ...(canEdit && done > 0 ? [{ label: 'Usuń odhaczone', onClick: () => clear.mutate() }] : []),
    ...(canEdit && total > 0
      ? [{ label: 'Wyczyść listę', danger: true, onClick: () => { if (window.confirm(`Wyczyścić całą listę zakupów (pozycji: ${total})?`)) clearAll.mutate() } }]
      : []),
  ]

  const aside = forRecipes.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 20, paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>Dla przepisów</span>
      {forRecipes.map(({ recipe, count }) => (
        <button
          key={recipe.id}
          type="button"
          onClick={() => nav(`/recipe/${recipe.id}`)}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
        >
          {recipe.imageUrl ? (
            <RecipeThumb r={{ imageUrl: recipe.imageUrl, tint: '#c9bca8', title: recipe.title }} style={{ width: 48, height: 48, borderRadius: 8 }} />
          ) : (
            <span style={{ width: 48, height: 48, flex: '0 0 48px', borderRadius: 8, background: 'repeating-linear-gradient(135deg,#e6dac7 0 8px,#ece2d2 8px 16px)' }} />
          )}
          <span style={{ flex: 1, minWidth: 0, font: sans(15, 500) }}>{recipe.title}</span>
          <span style={{ font: mono(12), color: 'var(--text-2)' }}>{count} poz.</span>
        </button>
      ))}
    </div>
  )

  const layoutSelect = items.length > 0 && (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
      Układ:
      <select
        value={layout}
        onChange={(e) => changeLayout(e.target.value as ShoppingLayout)}
        style={{ border: 0, background: 'transparent', font: mono(12), color: 'var(--text-2)', cursor: 'pointer', padding: 0 }}
      >
        <option value="alphabetical">alfabetycznie</option>
        <option value="lidl">alejki Lidl</option>
      </select>
    </label>
  )

  return (
    <ShoppingFrame
      counts={counts}
      actions={actions}
      aside={aside}
      hint="Dodawaj ręcznie, z przepisów albo przez asystenta."
      addBar={canEdit && <AddBar value={name} onChange={setName} onSubmit={submit} placeholder="Dodaj coś do kupienia…" />}
    >
      {isLoading ? (
        <span style={{ color: 'var(--text-3)' }}>Ładowanie…</span>
      ) : items.length === 0 ? (
        <div style={{ padding: '28px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 24 }}>Lista jest pusta</span>
          <span style={{ font: sans(14.5), color: 'var(--text-2)' }}>Dodaj coś ręcznie albo brakujące składniki z przepisu lub planu.</span>
        </div>
      ) : (
        <>
          <Progress done={done} total={total} right={layoutSelect} />
          {groups.map((g) => (
            <CheckGroup key={g.key} label={g.label?.replace(/^\d+\.\s*/, '') ?? 'Do kupienia'}>
              {g.items.map((s) => (
                <CheckRow
                  key={s.id}
                  checked={false}
                  name={s.name}
                  sub={rowSub(s)}
                  qty={s.quantity != null && s.unit ? formatQty(s.quantity, s.unit) : null}
                  onToggle={canEdit ? () => check.mutate(s.id) : undefined}
                  onRemove={canEdit ? () => remove.mutate(s.id) : undefined}
                />
              ))}
            </CheckGroup>
          ))}
          {checked.length > 0 && (
            <CheckGroup thin label={`W koszyku · ${checked.length}`}>
              {checked.map((s, i) => (
                <CheckRow
                  key={s.id}
                  checked
                  name={s.name}
                  sub={rowSub(s)}
                  qty={s.quantity != null && s.unit ? formatQty(s.quantity, s.unit) : null}
                  onToggle={canEdit ? () => check.mutate(s.id) : undefined}
                  last={i === checked.length - 1}
                />
              ))}
            </CheckGroup>
          )}
        </>
      )}
    </ShoppingFrame>
  )
}
