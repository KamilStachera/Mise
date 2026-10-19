import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  useAuth, useRecipe, useAddMissingToShopping, useDeleteRecipe, useCookLog, useAddCookLog, useDeleteCookLog,
  useCookProposal, useUploadRecipeImage, useDeleteRecipeImage, useSetDefaultRecipeImage, useSetRecipeServings,
} from '../api/hooks'
import type { CookProposalItem, RecipeDetail as Recipe, RecipeImage } from '../api/client'
import { dishLine, formatGrams, formatQty, plural, sourceEyebrow, unitLabel } from '../lib/labels'
import { IMAGE_ACCEPT } from '../lib/images'
import { requestChat } from '../lib/chatBus'
import { CookMode } from '../components/CookMode'
import { RecipeThumb } from '../components/RecipeThumb'
import { AddToPlanSheet } from '../components/AddToPlanSheet'
import { Button, Eyebrow, SectionHead, Sheet, StatusDot, inputStyle, mono, sans } from '../components/ui'
import { useIsMobile } from '../lib/useIsMobile'
import { ingredientDetailText } from '../lib/ingredients'

/** Height of the phone's sticky action bar (above the safe area). */
const ACTION_BAR = 78

export function RecipeDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const location = useLocation()
  const { canEdit } = useAuth()
  const { data: r, isLoading } = useRecipe(id)
  const addMissing = useAddMissingToShopping()
  const del = useDeleteRecipe()
  const upload = useUploadRecipeImage()
  const fileRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)

  // "Ugotuj ponownie" (History) lands here with { cook: true } in router state.
  // Capture it before clearing — CookLogSection mounts only after the recipe
  // loads, so reading location.state at that point would already see null.
  const [cookRequested] = useState(() => (location.state as { cook?: boolean } | null)?.cook === true)
  const [cookMode, setCookMode] = useState(false)
  useEffect(() => {
    if (cookRequested) nav(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (isLoading || !r) {
    return <div style={{ padding: isMobile ? 20 : '40px 44px', color: 'var(--text-3)' }}>Ładowanie…</div>
  }

  // Back returns to the list as it was left (filters, scroll); a deep link has no app history.
  const goBack = () => (location.key !== 'default' ? nav(-1) : nav('/'))

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

  const title = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 8 : 18 }}>
      {eyebrow && <Eyebrow tone="accent">{eyebrow}</Eyebrow>}
      <h1 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 32 : 44, lineHeight: isMobile ? 1.05 : 1.02, letterSpacing: '-0.025em', textWrap: 'balance' as never }}>
        {r.title}
      </h1>
      {r.blurb && <p style={{ margin: 0, font: sans(15), lineHeight: 1.5, color: 'var(--text-2)', textWrap: 'pretty' as never }}>{r.blurb}</p>}
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
      <MacroBar r={r} />
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
  const cook = cookMode && <CookMode title={r.title} steps={r.steps} ingredients={r.ingredients} servings={r.selectedServings} onClose={() => setCookMode(false)} />

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
                <button type="button" onClick={pickPhoto} disabled={upload.isPending} style={{ ...roundBtn, width: 'auto', padding: '0 16px', borderRadius: 999, font: sans(13, 600) }}>
                  {upload.isPending ? '…' : 'Zdjęcie'}
                </button>
              )}
              {canEdit && (
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
            <MenuRow onClick={() => { setMenuOpen(false); setPlanOpen(true) }}>Dodaj do planu</MenuRow>
            <MenuRow onClick={() => { setMenuOpen(false); pickPhoto() }}>{photoLabel}</MenuRow>
            <MenuRow onClick={() => { setMenuOpen(false); onDelete() }} danger>Usuń przepis</MenuRow>
          </div>
        </Sheet>
        {planSheet}
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
          <span style={{ display: 'flex', gap: 20 }}>
            <button type="button" onClick={() => setPlanOpen(true)} style={linkBtn}>Dodaj do planu</button>
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
function MacroBar({ r }: { r: Recipe }) {
  const isMobile = useIsMobile()
  const n = r.selectedServings
  const defs = [
    { key: 'B', grams: r.protein, color: 'var(--sage)', kcalPerGram: 4 },
    { key: 'T', grams: r.fat, color: 'var(--gold)', kcalPerGram: 9 },
    { key: 'W', grams: r.carbs, color: 'var(--accent)', kcalPerGram: 4 },
  ]
    .filter((d): d is typeof d & { grams: number } => d.grams != null)
    .map((d) => ({ ...d, grams: d.grams * n }))
  if (defs.length === 0) return null
  const total = defs.reduce((sum, d) => sum + d.grams * d.kcalPerGram, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {defs.length === 3 && total > 0 && (
        <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden' }}>
          {defs.map((d) => <span key={d.key} style={{ width: `${((d.grams * d.kcalPerGram) / total) * 100}%`, background: d.color }} />)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, font: mono(12), color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
        {defs.map((d) => (
          <span key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.color }} />
            {d.key} {formatGrams(d.grams)}
          </span>
        ))}
        <span style={{ marginLeft: 'auto' }}>na {plural(n, 'porcję', 'porcje', 'porcji')}{isMobile ? '' : ' · szacunkowo'}</span>
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
            onKeyDown={(e) => e.key === 'Enter' && onSave()}
            placeholder="Notatka — np. następnym razem mniej soli"
            autoFocus
            style={{ ...inputStyle, background: 'var(--bg)' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onSave} disabled={add.isPending}>{add.isPending ? 'Zapisywanie…' : 'Zapisz'}</Button>
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
