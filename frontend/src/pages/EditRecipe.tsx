import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { errorText } from '../api/client'
import { useAuth, useRecipeBase, useUpdateRecipe } from '../api/hooks'
import { LoginPrompt } from '../components/LoginPrompt'
import { RecipeForm, formToRecipeInput, recipeDetailToForm, type RecipeFormValues } from '../components/RecipeForm'
import { Button, PageTitle, sans, usePagePad } from '../components/ui'
import { showToast } from '../lib/toastBus'
import { useIsMobile } from '../lib/useIsMobile'

export function EditRecipe() {
  const { id } = useParams()
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { canEdit, isLoading: authLoading } = useAuth()
  const { data: recipe, isLoading, isError } = useRecipeBase(id)
  const update = useUpdateRecipe()

  const [values, setValues] = useState<RecipeFormValues | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (recipe && values === null) setValues(recipeDetailToForm(recipe))
  }, [recipe, values])

  if (authLoading) return null
  if (!canEdit) return <LoginPrompt title="Edycja przepisów wymaga zalogowania" />

  if (isError) {
    return (
      <div style={{ ...pad, maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
        <span style={{ fontFamily: 'var(--serif)', fontSize: 28 }}>Nie znaleziono przepisu</span>
        <Button variant="outline" onClick={() => nav('/')}>← Wróć do przepisów</Button>
      </div>
    )
  }

  if (isLoading || !recipe || !values) {
    return <div style={{ ...pad, color: 'var(--text-3)' }}>Ładowanie…</div>
  }

  async function submit() {
    if (!id || !values) return
    setError(null)
    const { payload, error: validationError } = formToRecipeInput(values)
    if (!payload) {
      setError(validationError ?? 'Sprawdź formularz.')
      return
    }
    try {
      await update.mutateAsync({ id, input: payload })
      showToast('Zapisano zmiany')
      nav(`/recipe/${id}`, { replace: true })
    } catch (e) {
      setError(errorText(e, 'Nie udało się zapisać zmian.'))
    }
  }

  return (
    <div style={{ ...pad, paddingBottom: isMobile ? 110 : 64, maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 20 : 28 }}>
      <button
        type="button"
        onClick={() => nav(`/recipe/${id}`)}
        style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: sans(14, 600), color: 'var(--text-2)' }}
      >
        ← Wróć do przepisu
      </button>
      <PageTitle title="Edytuj przepis" size={isMobile ? 40 : undefined} />
      <RecipeForm
        values={values}
        onChange={setValues}
        submitLabel="Zapisz zmiany"
        saving={update.isPending}
        error={error}
        onSubmit={submit}
        onCancel={() => nav(`/recipe/${id}`)}
      />
    </div>
  )
}
