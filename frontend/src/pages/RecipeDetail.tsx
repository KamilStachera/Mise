import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  useAuth, useChatHealth, useRecipe, useRecipes, useAddMissingToShopping, useDeleteRecipe, useCookLog, useAddCookLog, useDeleteCookLog,
  useCookProposal, useUploadRecipeImage, useDeleteRecipeImage, useSetDefaultRecipeImage, useSetRecipeServings,
  useSetRecipeFavorite, useSetRecipeTags, useSetRecipeNutrition,
  useRecipeShare, useCreateRecipeShare, useRevokeRecipeShare,
} from '../api/hooks'
import { errorText, type CookProposalItem, type RecipeDetail as Recipe, type RecipeImage } from '../api/client'
import { dishLine, formatGrams, formatQty, plural, sourceEyebrow, unitLabel } from '../lib/labels'
import { IMAGE_ACCEPT } from '../lib/images'
import { requestChat } from '../lib/chatBus'
import { normalizeTag, parseOptionalDecimal } from '../lib/recipeParsing'
import { showToast } from '../lib/toastBus'
import { RecipeThumb } from '../components/RecipeThumb'
import { AddToPlanSheet } from '../components/AddToPlanSheet'
import { Button, Chip, Eyebrow, SectionHead, Sheet, StatusDot, inputStyle, mono, sans } from '../components/ui'
import { useIsMobile } from '../lib/useIsMobile'
import { ingredientDetailText } from '../lib/ingredients'

const CookMode = lazy(() => import('../components/CookMode').then((m) => ({ default: m.CookMode })))

/** Height of the phone's sticky action bar (above the safe area). */
const ACTION_BAR = 78

export function RecipeDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const location = useLocation()
  const { canEdit } = useAuth()
  const { data: chatHealth } = useChatHealth()
  const { data: r, isLoading, isError } = useRecipe(id)
  const addMissing = useAddMissingToShopping()
  const del = useDeleteRecipe()
  const upload = useUploadRecipeImage()
  const setFav = useSetRecipeFavorite()
  const fileRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [nutritionOpen, setNutritionOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  // "Ugotuj ponownie" (History) lands here with { cook: true } in router state.
  // Capture it before clearing — CookLogSection mounts only after the recipe
  // loads, so reading location.state at that point would already see null.
  const [cookRequested] = useState(() => (location.state as { cook?: boolean } | null)?.cook === true)
  const [cookMode, setCookMode] = useState(false)
  useEffect(() => {
    if (cookRequested) nav(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Back returns to the list as it was left (filters, scroll); a deep link has no app history.
  const goBack = () => (location.key !== 'default' ? nav(-1) : nav('/'))

  if (isError) {
    return (
      <div style={{ padding: isMobile ? 20 : '40px 44px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
        <span style={{ fontFamily: 'var(--serif)', fontSize: 28 }}>Nie znaleziono przepisu</span>
        <span style={{ font: sans(14.5), color: 'var(--text-2)' }}>Ten przepis mógł zostać usunięty albo nie istnieje.</span>
        <Button variant="outline" onClick={goBack}>← Wróć do przepisów</Button>
      </div>
    )
  }

  if (isLoading || !r) {
    return <div style={{ padding: isMobile ? 20 : '40px 44px', color: 'var(--text-3)' }}>Ładowanie…</div>
  }

  async function onPick(file: File | undefined) {
    if (!file || !r) return
    try {
      await upload.mutateAsync({ id: r.id, file })
    } catch {
      alert('Nie udało się przesłać zdjęcia (JPG/PNG/WebP, maks. 5 MB).')
    }
  }

  async function onDelete() {
    if (r && confirm(`Usunąć „${r.title}”?`)) {
      await del.mutateAsync(r.id)
      nav('/')
    }
  }

  async function onAddMissing() {
    if (!r) return
    try {
      await addMissing.mutateAsync(r.id)
    } catch {
      return // the global mutation toast says what went wrong
    }
    nav('/shopping')
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept={IMAGE_ACCEPT}
      style={{ display: 'none' }}
      onChange={(e) => {
        onPick(e.target.files?.[0])
        e.target.value = ''
      }}
    />
  )
  const pickPhoto = () => fileRef.current?.click()
  const photoLabel = upload.isPending ? 'Przesyłanie…' : 'Dodaj zdjęcie'
  const canCook = r.steps.length > 0
  const showAddMissing = canEdit && r.missing.length > 0
  const eyebrow = [dishLine(r), r.usesAirFryer ? 'frytkownica' : ''].filter(Boolean).join(' · ')
  const recipeTags = r.tags ?? []
  const toggleFav = () => setFav.mutate({ id: r.id, favorite: !r.isFavorite })

  const title = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 8 : 16 }}>
      {eyebrow && <Eyebrow tone="accent">{eyebrow}</Eyebrow>}
      <h1 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 32 : 44, lineHeight: isMobile ? 1.05 : 1.02, letterSpacing: '-0.025em', textWrap: 'balance' as never }}>
        {r.isFavorite && !canEdit && <span style={{ color: 'var(--gold)', marginRight: 8 }} aria-label="Ulubiony">★</span>}
        {r.title}
      </h1>
      {r.blurb && <p style={{ margin: 0, font: sans(15), lineHeight: 1.5, color: 'var(--text-2)', textWrap: 'pretty' as never }}>{r.blurb}</p>}
      {(recipeTags.length > 0 || canEdit) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {recipeTags.map((t) => (
            <Chip key={t} onClick={() => nav(`/?tag=${encodeURIComponent(t)}`)}>
              #{t}
            </Chip>
          ))}
          {canEdit && (
            <button
              type="button"
              onClick={() => setTagsOpen(true)}
              style={{
                height: 30,
                padding: '0 10px',
                border: '1px dashed var(--border-2)',
                borderRadius: 999,
                background: 'transparent',
                color: 'var(--text-3)',
                cursor: 'pointer',
                font: sans(12.5, 500),
              }}
            >
              {recipeTags.length > 0 ? 'Edytuj tagi' : '+ Dodaj tag'}
            </button>
          )}
        </div>
      )}
    </div>
  )

  const facts = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
        <Fact first value={r.time} label="minut" />
        <Fact value={<ServingsStepper recipe={r} canEdit={canEdit} />} label={plural(r.selectedServings, 'porcja', 'porcje', 'porcji').replace(/^\d+ /, '')} />
        <Fact value={r.kcal != null ? `~${Math.round(r.kcal * r.selectedServings)}` : '—'} label="kcal" />
        <Fact value={<span style={{ font: sans(15, 500), lineHeight: '21.5px' }}>{r.difficulty}</span>} label="poziom" />
      </div>
      {r.selectedServings !== r.servings && (
        <span style={{ font: sans(12.5, 500), color: 'var(--accent-text)' }}>
          Przepis oryginalnie na {plural(r.servings, 'porcję', 'porcje', 'porcji')} — ilości i kcal przeliczone na {plural(r.selectedServings, 'porcję', 'porcje', 'porcji')}.
        </span>
      )}
      <MacroBar r={r} canEdit={canEdit} onEdit={() => setNutritionOpen(true)} />
    </div>
  )

  const actions = (canCook || showAddMissing) && (
    <div style={{ display: 'flex', gap: 10 }}>
      {isMobile && showAddMissing && (
        <Button variant="outline" size="xl" style={{ flex: 1 }} onClick={onAddMissing} disabled={addMissing.isPending}>
          + {r.missing.length} do zakupów
        </Button>
      )}
      {canCook && (
        <Button size={isMobile ? 'xl' : 'lg'} style={{ flex: 1.4 }} onClick={() => setCookMode(true)}>
          Gotuj krok po kroku
        </Button>
      )}
      {!isMobile && showAddMissing && (
        <Button variant="outline" size="lg" style={{ flex: 1 }} onClick={onAddMissing} disabled={addMissing.isPending}>
          + {r.missing.length} do zakupów
        </Button>
      )}
    </div>
  )

  const ingredients = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <SectionHead title="Składniki" size={isMobile ? 21 : 22} meta={r.missing.length === 0 ? `masz wszystko · ${r.total}` : `masz ${r.have} z ${r.total}`} />
      {r.ingredients.map((ing, i) => {
        const detail = ingredientDetailText(ing.displayText, ing.quantity)
        const followsAlternative = Boolean(ing.alternativeGroup && r.ingredients[i - 1]?.alternativeGroup === ing.alternativeGroup)
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isMobile ? '11px 0' : '10px 0', borderBottom: '1px solid var(--border)', font: sans(15) }}>
            <StatusDot status={ing.status === 'unknown' ? 'out' : ing.status} />
            <span style={{ flex: 1, minWidth: 0 }}>
              {followsAlternative && <span style={{ font: mono(11.5, 500), color: 'var(--text-3)', marginRight: 6 }}>lub</span>}
              {ing.name}
              {detail && <span style={{ display: 'block', marginTop: 2, font: sans(12.5), color: 'var(--text-3)' }}>{detail}</span>}
            </span>
            {ing.quantity && <span style={{ flex: '0 0 auto', font: mono(13), color: 'var(--text-2)', textAlign: 'right' }}>{ing.quantity}</span>}
          </div>
        )
      })}
      {r.missing.length > 0 && (
        <span style={{ padding: '10px 0 0', font: sans(13), lineHeight: 1.45, color: 'var(--text-2)' }}>
          Do kupienia: {r.missing.join(', ')}
        </span>
      )}
    </div>
  )

  const steps = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <SectionHead title="Przygotowanie" size={isMobile ? 21 : 22} />
      {r.steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ flex: '0 0 22px', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 24, lineHeight: 1, color: 'var(--accent-text)' }}>{i + 1}</span>
          <span style={{ font: sans(15), lineHeight: 1.5 }}>{step}</span>
        </div>
      ))}
      {r.tip && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 18, padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Eyebrow tone="accent">Wskazówka</Eyebrow>
          <span style={{ font: sans(14.5), lineHeight: 1.55 }}>{r.tip}</span>
        </div>
      )}
    </div>
  )

  const cookLog = <CookLogSection recipeId={r.id} initialOpen={cookRequested && canEdit} canEdit={canEdit} />
  const planSheet = canEdit && <AddToPlanSheet open={planOpen} onClose={() => setPlanOpen(false)} recipe={r} />
  const nutritionSheet = canEdit && <NutritionSheet open={nutritionOpen} onClose={() => setNutritionOpen(false)} recipe={r} />
  const tagsSheet = canEdit && <TagsSheet open={tagsOpen} onClose={() => setTagsOpen(false)} recipe={r} />
  const shareSheet = canEdit && <ShareRecipeSheet open={shareOpen} onClose={() => setShareOpen(false)} recipe={r} />
  const cook = cookMode && (
    <Suspense fallback={null}>
      <CookMode title={r.title} steps={r.steps} ingredients={r.ingredients} servings={r.selectedServings} onClose={() => setCookMode(false)} />
    </Suspense>
  )

  if (isMobile) {
    const roundBtn: CSSProperties = { width: 44, height: 44, borderRadius: '50%', border: 0, background: 'var(--surface)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer' }
    return (
      <div style={{ paddingBottom: actions ? `calc(${ACTION_BAR}px + env(safe-area-inset-bottom))` : 24 }}>
        {fileInput}
        <div style={{ position: 'relative', height: 320 }}>
          <RecipeThumb r={r} full letterSize={110} style={{ position: 'absolute', inset: 0 }} />
          <div style={{ position: 'absolute', top: 'calc(12px + env(safe-area-inset-top))', left: 16, right: 16, display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" aria-label="Wróć" onClick={goBack} style={roundBtn}>←</button>
            <div style={{ display: 'flex', gap: 8 }}>
              {canEdit && (
                <button
                  type="button"
                  aria-label={r.isFavorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
                  aria-pressed={r.isFavorite}
                  onClick={toggleFav}
                  style={{ ...roundBtn, color: r.isFavorite ? 'var(--gold)' : 'var(--text-3)' }}
                >
                  {r.isFavorite ? '★' : '☆'}
                </button>
              )}
              {canEdit && (
                <button type="button" onClick={pickPhoto} disabled={upload.isPending} style={{ ...roundBtn, width: 'auto', padding: '0 16px', borderRadius: 999, font: sans(13, 600) }}>
                  {upload.isPending ? '…' : 'Zdjęcie'}
                </button>
              )}
              {canEdit && chatHealth?.enabled && (
                <button type="button" aria-label="Zapytaj Sous" onClick={() => requestChat()} style={{ ...roundBtn, color: 'var(--accent)' }}>✦</button>
              )}
              {canEdit && (
                <button type="button" aria-label="Więcej" onClick={() => setMenuOpen(true)} style={{ ...roundBtn, letterSpacing: 1 }}>···</button>
              )}
            </div>
          </div>
          <span style={{ position: 'absolute', left: 16, bottom: 14, font: mono(10.5, 500), letterSpacing: '.1em', textTransform: 'uppercase', padding: '5px 8px', borderRadius: 5, background: 'var(--surface)' }}>
            {sourceEyebrow(r)}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '20px 20px 0' }}>
          {title}
          {facts}
          <PhotoGallery recipeId={r.id} images={r.images} canEdit={canEdit} />
          {ingredients}
          {steps}
          {cookLog}
        </div>
        {actions && (
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--rule)', background: 'var(--bg)' }}>
            {actions}
          </div>
        )}
        <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Przepis">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <MenuRow onClick={() => { setMenuOpen(false); nav(`/recipe/${r.id}/edit`) }}>Edytuj przepis</MenuRow>
            <MenuRow onClick={() => { setMenuOpen(false); setNutritionOpen(true) }}>Edytuj kcal i makro</MenuRow>
            <MenuRow onClick={() => { setMenuOpen(false); setTagsOpen(true) }}>Edytuj tagi</MenuRow>
            <MenuRow onClick={() => { setMenuOpen(false); setPlanOpen(true) }}>Dodaj do planu</MenuRow>
            <MenuRow onClick={() => { setMenuOpen(false); setShareOpen(true) }}>Udostępnij przepis</MenuRow>
            <MenuRow onClick={() => { setMenuOpen(false); pickPhoto() }}>{photoLabel}</MenuRow>
            <MenuRow onClick={() => { setMenuOpen(false); onDelete() }} danger>Usuń przepis</MenuRow>
          </div>
        </Sheet>
        {planSheet}
        {nutritionSheet}
        {tagsSheet}
        {shareSheet}
        {cook}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: '28px 44px 64px', maxWidth: 1240, margin: '0 auto' }}>
      {fileInput}
      <div style={{ display: 'flex', justifyContent: 'space-between', font: sans(14, 600), color: 'var(--text-2)' }}>
        <button type="button" onClick={goBack} style={linkBtn}>← Wszystkie przepisy</button>
        {canEdit && (
          <span style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <button
              type="button"
              aria-pressed={r.isFavorite}
              onClick={toggleFav}
              style={{ ...linkBtn, color: r.isFavorite ? 'var(--gold-text)' : 'inherit' }}
            >
              {r.isFavorite ? '★ Ulubiony' : '☆ Ulubiony'}
            </button>
            <button type="button" onClick={() => nav(`/recipe/${r.id}/edit`)} style={linkBtn}>Edytuj</button>
            <button type="button" onClick={() => setPlanOpen(true)} style={linkBtn}>Dodaj do planu</button>
            <button type="button" onClick={() => setShareOpen(true)} style={linkBtn}>Udostępnij</button>
            <button type="button" onClick={pickPhoto} disabled={upload.isPending} style={linkBtn}>{photoLabel}</button>
            <button type="button" onClick={onDelete} style={linkBtn}>Usuń</button>
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 36, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ position: 'relative' }}>
            <RecipeThumb r={r} full letterSize={110} style={{ height: 360, borderRadius: 16 }} />
            <span style={{ position: 'absolute', left: 14, top: 14, font: mono(10.5, 500), letterSpacing: '.1em', textTransform: 'uppercase', padding: '5px 8px', borderRadius: 5, background: 'var(--surface)' }}>
              {sourceEyebrow(r)}
            </span>
          </div>
          <PhotoGallery recipeId={r.id} images={r.images} canEdit={canEdit} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {title}
          {facts}
          {actions}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.25fr)', gap: 36, alignItems: 'start' }}>
        {ingredients}
        {steps}
      </div>
      {cookLog}
      {planSheet}
      {nutritionSheet}
      {tagsSheet}
      {shareSheet}
      {cook}
    </div>
  )
}

const linkBtn: CSSProperties = { border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }

function MenuRow({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ height: 52, display: 'flex', alignItems: 'center', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', font: sans(15.5, 500), color: danger ? 'var(--accent-text)' : 'var(--text)', textAlign: 'left', padding: 0 }}
    >
      {children}
    </button>
  )
}

function Fact({ value, label, first }: { value: ReactNode; label: string; first?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: first ? '10px 0' : '10px 0 10px 12px', borderLeft: first ? 0 : '1px solid var(--border)', minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', font: mono(18, 500) }}>{value}</span>
      <span style={{ font: sans(11.5), color: 'var(--text-2)' }}>{label}</span>
    </div>
  )
}

/**
 * Macros for the chosen portions (stored per portion, so ×selectedServings — the
 * same total as the kcal fact) as a calorie-share bar (protein/carbs 4 kcal per
 * gram, fat 9) with the grams underneath. The bar renders only when all three
 * are estimated; partial data shows just the numbers.
 */
function MacroBar({ r, canEdit, onEdit }: { r: Recipe; canEdit: boolean; onEdit: () => void }) {
  const isMobile = useIsMobile()
  const n = r.selectedServings
  const defs = [
    { key: 'B', grams: r.protein, color: 'var(--sage)', kcalPerGram: 4 },
    { key: 'T', grams: r.fat, color: 'var(--gold)', kcalPerGram: 9 },
    { key: 'W', grams: r.carbs, color: 'var(--accent)', kcalPerGram: 4 },
  ]
    .filter((d): d is typeof d & { grams: number } => d.grams != null)
    .map((d) => ({ ...d, grams: d.grams * n }))
  if (defs.length === 0) {
    if (!canEdit) return null
    return (
      <button
        type="button"
        onClick={onEdit}
        style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: sans(13, 600), color: 'var(--accent-text)' }}
      >
        + Uzupełnij kcal i makro
      </button>
    )
  }
  const total = defs.reduce((sum, d) => sum + d.grams * d.kcalPerGram, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {defs.length === 3 && total > 0 && (
        <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden' }}>
          {defs.map((d) => <span key={d.key} style={{ width: `${((d.grams * d.kcalPerGram) / total) * 100}%`, background: d.color }} />)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', font: mono(12), color: 'var(--text-2)' }}>
        {defs.map((d) => (
          <span key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.color }} />
            {d.key} {formatGrams(d.grams)}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>na {plural(n, 'porcję', 'porcje', 'porcji')}{isMobile ? '' : ' · szacunkowo'}</span>
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: sans(12, 600), color: 'var(--accent-text)' }}
            >
              Edytuj
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

/**
 * Portion picker (1–8; recipes written for more keep their base reachable).
 * Starts at one portion = one person. The choice is saved on the recipe, so it
 * survives navigation, and the server rescales ingredient amounts, missing/to-buy
 * and cook deductions to it; kcal and macros multiply on the client.
 */
function ServingsStepper({ recipe, canEdit }: { recipe: Recipe; canEdit: boolean }) {
  const set = useSetRecipeServings()
  const selected = recipe.selectedServings
  const max = Math.max(8, recipe.servings)
  if (!canEdit) return <>{selected}</>
  // 32px hit areas pulled back by negative margins: thumb-sized without widening the fact cell.
  const step = (disabled: boolean): CSSProperties => ({
    width: 32,
    height: 32,
    margin: '-6px -8px',
    border: 0,
    background: 'transparent',
    padding: 0,
    font: mono(18, 500),
    color: disabled ? 'var(--border-2)' : 'var(--text-3)',
    cursor: disabled ? 'default' : 'pointer',
  })
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button type="button" title="Mniej porcji" disabled={selected <= 1 || set.isPending} onClick={() => set.mutate({ id: recipe.id, servings: selected - 1 })} style={step(selected <= 1 || set.isPending)}>−</button>
      <span>{selected}</span>
      <button type="button" title="Więcej porcji" disabled={selected >= max || set.isPending} onClick={() => set.mutate({ id: recipe.id, servings: selected + 1 })} style={step(selected >= max || set.isPending)}>+</button>
    </span>
  )
}

/** Thumbnails of every uploaded photo; click promotes one to the hero, ✕ removes it (read-only: view only). */
function PhotoGallery({ recipeId, images, canEdit }: { recipeId: string; images: RecipeImage[]; canEdit: boolean }) {
  const setDefault = useSetDefaultRecipeImage()
  const del = useDeleteRecipeImage()
  // A lone photo is already the hero; editors still get its thumbnail to delete it.
  if (images.length === 0 || (images.length === 1 && !canEdit)) return null

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {images.map((img) => (
        <div key={img.id} style={{ position: 'relative' }}>
          <img
            src={img.url}
            alt=""
            title={canEdit ? (img.isDefault ? 'Zdjęcie główne' : 'Ustaw jako główne') : undefined}
            onClick={() => canEdit && !img.isDefault && setDefault.mutate({ id: recipeId, imageId: img.id })}
            style={{
              display: 'block',
              width: 72,
              height: 54,
              objectFit: 'cover',
              borderRadius: 8,
              cursor: canEdit && !img.isDefault ? 'pointer' : 'default',
              outline: img.isDefault ? '2px solid var(--accent)' : 'none',
              outlineOffset: 2,
              opacity: img.isDefault ? 1 : 0.8,
            }}
          />
          {canEdit && (
            <button
              type="button"
              onClick={() => confirm('Usunąć to zdjęcie?') && del.mutate({ id: recipeId, imageId: img.id })}
              title="Usuń zdjęcie"
              style={{ position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer', font: sans(10, 600), lineHeight: 1, padding: 0 }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

const SKIP_REASON_PL: Record<string, string> = {
  unlinked: 'brak dopasowania w spiżarni',
  unparsed: 'nieprzeliczalna ilość',
  'unit-mismatch': 'inna jednostka',
  'alternative-not-selected': 'wybierz jeden zamiennik',
}

/** Editable checkbox+amount state for one proposal row of the cook dialog. */
type DeductionRow = { checked: boolean; amount: string }

function parseAmount(s: string): number | null {
  if (!s.trim()) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function Stars({ value }: { value: number }) {
  return (
    <span style={{ color: 'var(--gold)', fontSize: 14, letterSpacing: 2, flex: '0 0 auto' }}>
      {'★'.repeat(value)}
      <span style={{ color: 'var(--border)' }}>{'★'.repeat(5 - value)}</span>
    </span>
  )
}

function CookLogSection({ recipeId, initialOpen = false, canEdit }: { recipeId: string; initialOpen?: boolean; canEdit: boolean }) {
  const { data: entries } = useCookLog(recipeId)
  const add = useAddCookLog()
  const del = useDeleteCookLog()
  const [open, setOpen] = useState(initialOpen)
  const [rating, setRating] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [showDeductions, setShowDeductions] = useState(false)
  const { data: proposal } = useCookProposal(recipeId, open)
  const [rows, setRows] = useState<Record<string, DeductionRow> | null>(null)

  // Pre-fill once per dialog opening: deductible rows checked with the recipe amount.
  useEffect(() => {
    if (!open) {
      setRows(null)
      setShowDeductions(false)
      return
    }
    if (proposal && rows === null) {
      setRows(Object.fromEntries(proposal.items.map((it) => [
        it.ingredientId,
        { checked: it.deductible, amount: it.proposedAmount != null ? String(it.proposedAmount).replace('.', ',') : '' },
      ])))
    }
  }, [open, proposal, rows])

  async function onSave() {
    const deductions = (proposal?.items ?? [])
      .filter((it) => it.pantryItemId && rows?.[it.ingredientId]?.checked)
      .flatMap((it) => {
        const amount = parseAmount(rows![it.ingredientId].amount)
        return amount != null && amount > 0 ? [{ pantryItemId: it.pantryItemId!, amount }] : []
      })
    await add.mutateAsync({
      recipeId,
      rating: rating ?? undefined,
      note: note.trim() || undefined,
      deductions: deductions.length > 0 ? deductions : undefined,
    })
    setOpen(false)
    setRating(null)
    setNote('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 22 }}>Historia gotowania</span>
          <span style={{ font: sans(13), color: 'var(--text-3)' }}>Oceny i notatki trafiają do cooklog.md — asystent uczy się z nich, co u Was działa.</span>
        </div>
        {canEdit && !open && <Button size="sm" variant="dark" onClick={() => setOpen(true)}>Ugotowane!</Button>}
      </div>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: sans(15, 600) }}>Potwierdź ugotowanie</span>
            <span style={{ font: sans(13), lineHeight: 1.45, color: 'var(--text-2)' }}>
              Domyślnie odejmiemy składniki zgodnie z przepisem. Stan pozostanie przybliżony, więc drobnych różnic nie trzeba poprawiać.
            </span>
          </div>
          {!proposal || !rows ? (
            <span style={{ font: sans(13), color: 'var(--text-3)' }}>Ładowanie…</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                onClick={() => setShowDeductions((value) => !value)}
                style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: sans(13, 600), color: 'var(--accent-text)' }}
              >
                {showDeductions ? 'Ukryj szczegóły' : `Zmieniliśmy składniki lub ilości · ${proposal.items.filter((item) => item.deductible).length} odjęć`}
              </button>
              {showDeductions && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {proposal.items.map((it) => (
                    <DeductionRowView
                      key={it.ingredientId}
                      item={it}
                      row={rows[it.ingredientId]}
                      onChange={(row) => setRows((current) => {
                        if (!current) return current
                        const next = { ...current, [it.ingredientId]: row }
                        if (row.checked && it.alternativeGroup) {
                          for (const option of proposal.items) {
                            if (option.ingredientId !== it.ingredientId
                                && option.alternativeGroup === it.alternativeGroup) {
                              next[option.ingredientId] = {
                                ...(next[option.ingredientId] ?? { amount: '' }),
                                checked: false,
                              }
                            }
                          }
                        }
                        return next
                      })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ font: sans(14), color: 'var(--text-2)' }}>Jak wyszło?</span>
            <div>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(rating === n ? null : n)}
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 24, lineHeight: 1, padding: '0 2px', color: rating !== null && n <= rating ? 'var(--gold)' : 'var(--border)' }}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && proposal && rows && !add.isPending) onSave() }}
            placeholder="Notatka — np. następnym razem mniej soli"
            autoFocus
            style={{ ...inputStyle, background: 'var(--bg)' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onSave} disabled={add.isPending || !proposal || !rows}>{add.isPending ? 'Zapisywanie…' : 'Zapisz'}</Button>
            <Button variant="quiet" onClick={() => setOpen(false)}>Anuluj</Button>
          </div>
        </div>
      )}

      {entries && entries.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {entries.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ font: mono(12.5), color: 'var(--text-2)', flex: '0 0 90px' }}>{e.cookedAt}</span>
              {e.rating !== null && <Stars value={e.rating} />}
              <span style={{ flex: 1, font: sans(14.5), color: e.note ? 'var(--text)' : 'var(--text-3)' }}>{e.note || 'bez notatki'}</span>
              {canEdit && (
                <button type="button" onClick={() => del.mutate(e.id)} title="Usuń wpis" style={{ border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: 13 }}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <span style={{ font: sans(14), color: 'var(--text-3)' }}>Jeszcze nie gotowaliście z tego przepisu.</span>
      )}
    </div>
  )
}

/** One ingredient row of the cook dialog: checkbox, editable amount, pantry stock hint. */
function DeductionRowView({ item, row, onChange }: {
  item: CookProposalItem
  row: DeductionRow | undefined
  onChange: (row: DeductionRow) => void
}) {
  // Rows without a pantry link can never deduct; unparsed/mismatch rows can be
  // opted in manually (the user types the amount in the pantry item's unit).
  const canDeduct = item.pantryItemId != null
  const checked = row?.checked ?? false
  const detail = ingredientDetailText(item.displayText, item.quantityText)

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)', opacity: canDeduct ? 1 : 0.55 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!canDeduct}
        onChange={(e) => onChange({ checked: e.target.checked, amount: row?.amount ?? '' })}
        style={{ accentColor: 'var(--sage)', width: 16, height: 16, cursor: canDeduct ? 'pointer' : 'default' }}
      />
      <span style={{ flex: 1, minWidth: 120, font: sans(14, 500) }}>
        {item.name}
        {detail
          ? <span style={{ display: 'block', font: sans(12), color: 'var(--text-3)', marginTop: 2 }}>{detail}</span>
          : item.quantityText && <span style={{ font: mono(12), color: 'var(--text-3)', marginLeft: 7 }}>{item.quantityText}</span>}
      </span>
      {!canDeduct ? (
        <span style={{ font: sans(12.5), color: 'var(--text-3)', fontStyle: 'italic' }}>{SKIP_REASON_PL[item.skipReason ?? ''] ?? 'pominięte'}</span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {item.skipReason && <span style={{ font: sans(12), color: 'var(--accent-text)' }}>{SKIP_REASON_PL[item.skipReason]}</span>}
          <input
            value={row?.amount ?? ''}
            disabled={!checked}
            onChange={(e) => onChange({ checked, amount: e.target.value })}
            inputMode="decimal"
            placeholder="0"
            style={{ width: 64, height: 34, textAlign: 'right', border: '1px solid var(--border)', background: checked ? 'var(--bg)' : 'transparent', borderRadius: 8, padding: '0 8px', font: mono(13), color: 'var(--text)' }}
          />
          <span style={{ font: sans(12.5), color: 'var(--text-2)', width: 28 }}>{item.unit ? unitLabel[item.unit] : ''}</span>
          <span style={{ font: mono(11.5), color: 'var(--text-3)', minWidth: 96, textAlign: 'right' }}>
            {item.pantryQuantity != null && item.unit ? `w domu: ${formatQty(item.pantryQuantity, item.unit)}` : ''}
          </span>
        </span>
      )}
    </div>
  )
}

/** Lightweight PATCH /recipes/{id}/nutrition editor — edits macros per 1 serving without touching ingredients/steps. */
function NutritionSheet({ open, onClose, recipe }: { open: boolean; onClose: () => void; recipe: Recipe }) {
  const save = useSetRecipeNutrition()
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [fat, setFat] = useState('')
  const [carbs, setCarbs] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKcal(recipe.kcal != null ? String(recipe.kcal) : '')
    setProtein(recipe.protein != null ? String(recipe.protein).replace('.', ',') : '')
    setFat(recipe.fat != null ? String(recipe.fat).replace('.', ',') : '')
    setCarbs(recipe.carbs != null ? String(recipe.carbs).replace('.', ',') : '')
    setError(null)
  }, [open, recipe.kcal, recipe.protein, recipe.fat, recipe.carbs])

  async function submit() {
    setError(null)
    const k = parseOptionalDecimal(kcal)
    const p = parseOptionalDecimal(protein)
    const f = parseOptionalDecimal(fat)
    const c = parseOptionalDecimal(carbs)
    if (k == null || k <= 0 || p == null || p < 0 || f == null || f < 0 || c == null || c < 0) {
      setError('Podaj komplet: kcal > 0 oraz białko, tłuszcz i węglowodany ≥ 0 (na jedną porcję).')
      return
    }
    try {
      await save.mutateAsync({
        id: recipe.id,
        input: { kcal: Math.round(k), protein: p, fat: f, carbs: c },
      })
      showToast('Zapisano wartości odżywcze')
      onClose()
    } catch (e) {
      setError(errorText(e, 'Nie udało się zapisać wartości odżywczych.'))
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Kcal i makro (1 porcja)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ font: sans(13.5), color: 'var(--text-2)', lineHeight: 1.45 }}>
          Podaj wartości szacunkowe dla <strong>jednej porcji</strong> (1 osoba). Aplikacja automatycznie mnoży je przez wybraną liczbę porcji.
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Eyebrow>Kalorie (kcal)</Eyebrow>
            <input style={{ ...inputStyle, font: mono(15) }} inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="np. 480" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Eyebrow>Białko (g)</Eyebrow>
            <input style={{ ...inputStyle, font: mono(15) }} inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} placeholder="np. 32" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Eyebrow>Tłuszcz (g)</Eyebrow>
            <input style={{ ...inputStyle, font: mono(15) }} inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} placeholder="np. 16" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Eyebrow>Węglowodany (g)</Eyebrow>
            <input style={{ ...inputStyle, font: mono(15) }} inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} placeholder="np. 45" />
          </label>
        </div>
        {error && <span role="alert" style={{ font: sans(13.5, 500), color: 'var(--accent-text)' }}>{error}</span>}
        <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
          <Button variant="outline" size="xl" style={{ flex: 1 }} onClick={onClose}>Anuluj</Button>
          <Button size="xl" style={{ flex: 1.4 }} onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Zapisywanie…' : 'Zapisz'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/** Lightweight PUT /recipes/{id}/tags editor with suggestions from existing household tags. */
function TagsSheet({ open, onClose, recipe }: { open: boolean; onClose: () => void; recipe: Recipe }) {
  const { data: allRecipes } = useRecipes('all', '')
  const save = useSetRecipeTags()
  const [tags, setTags] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTags(recipe.tags ?? [])
    setDraft('')
    setError(null)
  }, [open, recipe.tags])

  const suggestions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of allRecipes ?? []) {
      for (const t of r.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl-PL'))
      .map(([t]) => t)
      .filter((t) => !tags.includes(t))
      .slice(0, 12)
  }, [allRecipes, tags])

  function add(raw: string) {
    const clean = normalizeTag(raw)
    if (!clean) return
    if (tags.length >= 15 || tags.includes(clean)) {
      setDraft('')
      return
    }
    setTags((prev) => [...prev, clean])
    setDraft('')
  }

  async function submit() {
    setError(null)
    const pending = normalizeTag(draft)
    const finalTags = pending && !tags.includes(pending) && tags.length < 15 ? [...tags, pending] : tags
    try {
      await save.mutateAsync({ id: recipe.id, tags: finalTags })
      showToast('Zapisano tagi')
      onClose()
    } catch (e) {
      setError(errorText(e, 'Nie udało się zapisać tagów.'))
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Tagi i kolekcje">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={draft}
            maxLength={40}
            placeholder="np. do pudełka, szybkie, na gości"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                add(draft)
              }
            }}
          />
          <Button variant="outline" size="md" onClick={() => add(draft)} disabled={!normalizeTag(draft) || tags.length >= 15}>
            + Dodaj
          </Button>
        </div>
        {tags.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map((t) => (
              <Chip key={t} active onClick={() => setTags((prev) => prev.filter((x) => x !== t))}>
                #{t} ✕
              </Chip>
            ))}
          </div>
        ) : (
          <span style={{ font: sans(13.5), color: 'var(--text-3)' }}>Brak przypisanych tagów.</span>
        )}
        {suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Eyebrow>Twoje tagi</Eyebrow>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {suggestions.map((t) => (
                <Chip key={t} onClick={() => add(t)}>+ #{t}</Chip>
              ))}
            </div>
          </div>
        )}
        {error && <span role="alert" style={{ font: sans(13.5, 500), color: 'var(--accent-text)' }}>{error}</span>}
        <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
          <Button variant="outline" size="xl" style={{ flex: 1 }} onClick={onClose}>Anuluj</Button>
          <Button size="xl" style={{ flex: 1.4 }} onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Zapisywanie…' : 'Zapisz tagi'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

function ShareRecipeSheet({ open, onClose, recipe }: { open: boolean; onClose: () => void; recipe: Recipe }) {
  const { data: share, isLoading } = useRecipeShare(recipe.id, open)
  const create = useCreateRecipeShare()
  const revoke = useRevokeRecipeShare()
  const [error, setError] = useState<string | null>(null)

  const fullUrl = share?.active && share.path ? `${window.location.origin}${share.path}` : null
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function onCreate() {
    setError(null)
    try {
      const created = await create.mutateAsync(recipe.id)
      if (created.path) {
        const url = `${window.location.origin}${created.path}`
        await navigator.clipboard.writeText(url).catch(() => undefined)
        showToast('Utworzono i skopiowano link do przepisu.')
      }
    } catch (err) {
      setError(errorText(err, 'Nie udało się utworzyć linku.'))
    }
  }

  async function onCopy() {
    if (!fullUrl) return
    try {
      await navigator.clipboard.writeText(fullUrl)
      showToast('Skopiowano link do schowka.')
    } catch {
      showToast('Nie udało się skopiować linku.')
    }
  }

  async function onNativeShare() {
    if (!fullUrl || !canNativeShare) return
    try {
      await navigator.share({ title: recipe.title, url: fullUrl })
    } catch {
      /* user cancelled share sheet */
    }
  }

  async function onRevoke() {
    setError(null)
    try {
      await revoke.mutateAsync(recipe.id)
      showToast('Cofnięto udostępnianie przepisu.')
    } catch (err) {
      setError(errorText(err, 'Nie udało się cofnąć linku.'))
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Udostępnij przepis" width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, font: sans(14.5), lineHeight: 1.5, color: 'var(--text-2)' }}>
          Każdy z tym linkiem zobaczy sam przepis ze zdjęciem (bez Twojej spiżarni, notatek z historii ani planu).
          Zalogowani znajomi z innego domu w Pichci zapiszą własną kopię jednym kliknięciem.
        </p>

        {isLoading ? (
          <span style={{ font: sans(14), color: 'var(--text-3)' }}>Sprawdzam aktywny link…</span>
        ) : fullUrl ? (
          <>
            <input
              readOnly
              value={fullUrl}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Link do udostępnionego przepisu"
              style={{ ...inputStyle, font: mono(13), color: 'var(--text)' }}
            />
            {share?.expiresAt && (
              <span style={{ font: mono(12), color: 'var(--text-3)' }}>
                Ważny do {new Date(share.expiresAt).toLocaleDateString('pl-PL')}
              </span>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button size="lg" style={{ flex: 1 }} onClick={onCopy}>Kopiuj link</Button>
              {canNativeShare && (
                <Button variant="outline" size="lg" onClick={onNativeShare}>Wyślij…</Button>
              )}
            </div>
            <Button
              variant="text"
              style={{ alignSelf: 'flex-start', color: 'var(--accent-text)', font: sans(13.5, 600) }}
              disabled={revoke.isPending}
              onClick={onRevoke}
            >
              {revoke.isPending ? 'Cofam…' : 'Cofnij udostępnianie'}
            </Button>
          </>
        ) : (
          <Button size="xl" disabled={create.isPending} onClick={onCreate}>
            {create.isPending ? 'Tworzę link…' : 'Utwórz link (ważny 30 dni)'}
          </Button>
        )}

        {error && <span role="alert" style={{ font: sans(13.5, 500), color: 'var(--accent-text)' }}>{error}</span>}
      </div>
    </Sheet>
  )
}
