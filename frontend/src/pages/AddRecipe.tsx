import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { errorText, type ImportedRecipe, type UrlImportResult } from '../api/client'
import { useAuth, useChatHealth, useCreateRecipe, useImportUrl, useUploadRecipeImage, useUploadRecipeImageFromUrl } from '../api/hooks'
import { LoginPrompt } from '../components/LoginPrompt'
import { RecipeForm, emptyRecipeForm, formToRecipeInput, type RecipeFormValues } from '../components/RecipeForm'
import { Button, Chip, Eyebrow, PageTitle, UnderlineTabs, inputStyle, mono, sans, usePagePad } from '../components/ui'
import { requestChat } from '../lib/chatBus'
import { IMAGE_ACCEPT } from '../lib/images'
import {
  deriveImportSourceName,
  parseIngredient,
  parseNutritionNumber,
  parseRecipe,
  parseYieldServings,
} from '../lib/recipeParsing'
import { showToast } from '../lib/toastBus'
import { useIsMobile } from '../lib/useIsMobile'

type ImportTab = 'url' | 'paste'

export function AddRecipe() {
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { canEdit, isLoading: authLoading } = useAuth()
  const { data: chatHealth } = useChatHealth()
  const create = useCreateRecipe()
  const uploadImage = useUploadRecipeImage()
  const uploadImageFromUrl = useUploadRecipeImageFromUrl()
  const importUrl = useImportUrl()

  const [tab, setTab] = useState<ImportTab>('url')
  const [urlInput, setUrlInput] = useState('')
  const [urlResult, setUrlResult] = useState<UrlImportResult | null>(null)
  const [urlNotice, setUrlNotice] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [paste, setPaste] = useState('')

  const [values, setValues] = useState<RecipeFormValues>(() => ({ ...emptyRecipeForm(), source: 'web' }))
  const [error, setError] = useState<string | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [remotePhotoUrl, setRemotePhotoUrl] = useState<string | null>(null)
  const [useRemotePhoto, setUseRemotePhoto] = useState(true)
  const photoRef = useRef<HTMLInputElement>(null)

  const photoPreview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
  }, [photoPreview])

  // After all hooks (rules of hooks). Adding recipes is edit-only.
  if (authLoading) return null
  if (!canEdit) return <LoginPrompt title="Dodawanie przepisów wymaga zalogowania" />

  function applyImportedRecipe(recipe: ImportedRecipe, sourceUrl: string, fallbackImage: string | null) {
    const minutes =
      recipe.totalMinutes ??
      ((recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0) > 0
        ? (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0)
        : 30)
    const servings = parseYieldServings(recipe.yield) ?? 2
    const kcal = parseNutritionNumber(recipe.nutrition?.calories)
    const protein = parseNutritionNumber(recipe.nutrition?.protein)
    const fat = parseNutritionNumber(recipe.nutrition?.fat)
    const carbs = parseNutritionNumber(recipe.nutrition?.carbs)
    const ings = recipe.ingredients.map((line) => parseIngredient(line)).filter((i) => i.name)
    const steps = recipe.steps.map((s) => s.trim()).filter(Boolean)

    setValues((prev) => ({
      ...prev,
      title: recipe.name?.trim() || prev.title,
      source: 'web',
      sourceName: deriveImportSourceName(recipe, sourceUrl) || prev.sourceName,
      time: Math.min(1440, Math.max(0, minutes)),
      servings,
      blurb: recipe.description?.trim() ?? '',
      kcal: kcal != null && kcal > 0 ? String(Math.round(kcal)) : '',
      protein: protein != null ? String(protein).replace('.', ',') : '',
      fat: fat != null ? String(fat).replace('.', ',') : '',
      carbs: carbs != null ? String(carbs).replace('.', ',') : '',
      ings: ings.length > 0 ? ings : prev.ings,
      steps: steps.length > 0 ? steps : prev.steps,
    }))

    const img = recipe.imageUrl ?? fallbackImage
    if (img && /^https?:\/\//i.test(img)) {
      setRemotePhotoUrl(img)
      setUseRemotePhoto(true)
    } else {
      setRemotePhotoUrl(null)
    }
  }

  async function fetchFromUrl() {
    const raw = urlInput.trim()
    if (!raw) return
    setUrlError(null)
    setUrlNotice(null)
    setUrlResult(null)
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    try {
      const res = await importUrl.mutateAsync(normalized)
      setUrlResult(res)
      if (res.kind === 'pdf') {
        setUrlNotice('Ten link prowadzi do pliku PDF — otwórz go przez Sous (albo wklej tekst ręcznie w zakładce „Wklej tekst”).')
        return
      }
      if (res.recipes.length > 0) {
        applyImportedRecipe(res.recipes[0], res.url, res.imageUrl)
        setUrlNotice(
          res.recipes.length > 1
            ? `Znaleziono ${res.recipes.length} przepisy na stronie — wczytano pierwszy. Możesz przełączyć poniżej.`
            : 'Wczytano przepis ze strony. Sprawdź składniki, porcje i zapisz.',
        )
      } else {
        const fallbackText = [res.title, res.text].filter(Boolean).join('\n\n')
        if (fallbackText) {
          setPaste(fallbackText)
          setTab('paste')
        }
        setUrlNotice('Strona nie ma ustrukturyzowanego przepisu (JSON-LD/mikrodane) — wkleiliśmy jej tekst poniżej. Przetwórz go albo poproś Sous.')
      }
    } catch (e) {
      setUrlError(errorText(e, 'Nie udało się pobrać strony z przepisem.'))
    }
  }

  function applyParsed() {
    const p = parseRecipe(paste)
    setValues((prev) => ({
      ...prev,
      title: p.title || prev.title,
      blurb: p.blurb || prev.blurb,
      ings: p.ingredients.length ? p.ingredients : prev.ings,
      steps: p.steps.length ? p.steps : prev.steps,
    }))
  }

  async function submit() {
    setError(null)
    const { payload, error: validationError } = formToRecipeInput(values)
    if (!payload) {
      setError(validationError ?? 'Sprawdź formularz.')
      return
    }
    try {
      const { id } = await create.mutateAsync(payload)
      if (photo) {
        try {
          await uploadImage.mutateAsync({ id, file: photo })
        } catch {
          showToast('Przepis zapisany, ale zdjęcie się nie przesłało (JPG/PNG/WebP, maks. 5 MB).')
        }
      } else if (remotePhotoUrl && useRemotePhoto) {
        try {
          await uploadImageFromUrl.mutateAsync({ id, url: remotePhotoUrl })
        } catch {
          showToast('Przepis zapisany, ale nie udało się pobrać zdjęcia ze strony.')
        }
      }
      nav(`/recipe/${id}`)
    } catch (e) {
      setError(errorText(e, 'Nie udało się zapisać przepisu.'))
    }
  }

  const saving = create.isPending || uploadImage.isPending || uploadImageFromUrl.isPending

  const photoSection = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <Eyebrow>Zdjęcie (opcjonalnie)</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          ref={photoRef}
          type="file"
          accept={IMAGE_ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => {
            setPhoto(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />
        <Button variant="quiet" onClick={() => photoRef.current?.click()}>
          {photo ? 'Zmień plik' : 'Wybierz zdjęcie'}
        </Button>
        {photoPreview && (
          <>
            <img src={photoPreview} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 10 }} />
            <button
              type="button"
              onClick={() => setPhoto(null)}
              title="Usuń zdjęcie"
              style={{ border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: 14 }}
            >
              ✕
            </button>
          </>
        )}
        {!photo && remotePhotoUrl && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: sans(13.5), color: 'var(--text-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useRemotePhoto}
              onChange={(e) => setUseRemotePhoto(e.target.checked)}
            />
            Pobierz zdjęcie ze strony przy zapisie
          </label>
        )}
      </div>
    </div>
  )

  return (
    <div style={{ ...pad, paddingBottom: isMobile ? 110 : 64, maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 20 : 28 }}>
      <button
        type="button"
        onClick={() => nav('/')}
        style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: sans(14, 600), color: 'var(--text-2)' }}
      >
        ← Wszystkie przepisy
      </button>
      <PageTitle title="Dodaj przepis" size={isMobile ? 40 : undefined} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <UnderlineTabs
          rule
          value={tab}
          onChange={setTab}
          items={[
            { key: 'url', label: 'Z linku (WWW)' },
            { key: 'paste', label: 'Wklej tekst' },
          ]}
        />

        {tab === 'url' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ font: sans(13.5), color: 'var(--text-2)' }}>
              Wklej adres z bloga (np. AniaGotuje, Kwestia Smaku, Jadłonomia) — automatycznie wyciągniemy składniki, kroki, makro i zdjęcie.
            </span>
            <div style={{ display: 'flex', gap: 8, flexDirection: isMobile ? 'column' : 'row' }}>
              <input
                type="url"
                style={{ ...inputStyle, flex: 1, background: 'var(--bg)' }}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://aniagotuje.pl/przepis/..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    fetchFromUrl()
                  }
                }}
              />
              <Button variant="dark" size="md" onClick={fetchFromUrl} disabled={!urlInput.trim() || importUrl.isPending}>
                {importUrl.isPending ? 'Pobieranie…' : 'Pobierz przepis'}
              </Button>
            </div>
            {urlError && (
              <span role="alert" style={{ font: sans(13.5, 500), color: 'var(--accent-text)' }}>
                {urlError}
              </span>
            )}
            {urlNotice && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ font: sans(13.5), color: 'var(--text-2)' }}>{urlNotice}</span>
                {chatHealth?.enabled && urlResult && (urlResult.kind === 'pdf' || urlResult.recipes.length === 0) && (
                  <Button
                    variant="outline"
                    size="sm"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => requestChat(`Zaimportuj przepis z tego linku: ${urlResult.url}`)}
                  >
                    ✦ Poproś Sous o import tego linku
                  </Button>
                )}
              </div>
            )}
            {urlResult && urlResult.recipes.length > 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {urlResult.recipes.map((r, idx) => (
                  <Chip key={idx} active={values.title === r.name.trim()} onClick={() => applyImportedRecipe(r, urlResult.url, urlResult.imageUrl)}>
                    {r.name || `Przepis ${idx + 1}`}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'Wklej przepis (np. z ChatGPT) i kliknij Przetwórz.\nNajlepiej działa z nagłówkami „Składniki” i „Przygotowanie”.'}
              style={{ ...inputStyle, height: 'auto', minHeight: 120, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5, font: mono(12.5), background: 'var(--bg)' }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="dark" size="sm" onClick={applyParsed} disabled={!paste.trim()}>
                Przetwórz do formularza ↓
              </Button>
              {chatHealth?.enabled && urlResult && urlResult.recipes.length === 0 && (
                <Button variant="outline" size="sm" onClick={() => requestChat(`Zaimportuj przepis z tego linku: ${urlResult.url}`)}>
                  ✦ Poproś Sous o import
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <RecipeForm
        values={values}
        onChange={setValues}
        submitLabel="Zapisz przepis"
        saving={saving}
        error={error}
        onSubmit={submit}
        onCancel={() => nav('/')}
        photoSection={photoSection}
      />
    </div>
  )
}
