import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  useAuth, useRecipe, useAddMissingToShopping, useDeleteRecipe, useCookLog, useAddCookLog, useDeleteCookLog,
  useCookProposal, useUploadRecipeImage, useDeleteRecipeImage, useSetDefaultRecipeImage,
} from '../api/hooks'
import type { CookProposalItem, RecipeImage } from '../api/client'
import { gradient } from '../lib/colors'
import { cuisineLabel, dishTypeLabel, formatGrams, formatQty, sourceBadge, statusColor, unitLabel } from '../lib/labels'
import { BackIcon, ClockIcon, ServingsIcon, PlayIcon, PlusIcon, TrashIcon, CameraIcon } from '../components/icons'
import { IMAGE_ACCEPT } from '../lib/images'
import { CookMode } from '../components/CookMode'
import { useIsMobile } from '../lib/useIsMobile'
import { ingredientDetailText } from '../lib/ingredients'

export function RecipeDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const location = useLocation()
  const { canEdit } = useAuth()
  const { data: r, isLoading } = useRecipe(id)
  const addMissing = useAddMissingToShopping()
  const del = useDeleteRecipe()

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
    return <div style={{ padding: 40, color: 'var(--text-3)', maxWidth: 780, margin: '0 auto' }}>Ładowanie…</div>
  }

  const haveSummary =
    r.missing.length === 0
      ? `Masz wszystko — ${r.have} z ${r.total} składników w domu.`
      : `Masz ${r.have} z ${r.total}. Do kupienia (${r.missing.length}): ${r.missing.join(', ')}.`

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: isMobile ? '18px 14px 44px' : '26px 42px 70px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={() => nav('/')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', font: "500 13.5px 'Hanken Grotesk'", padding: '6px 0', marginBottom: 14 }}
        >
          <BackIcon /> Wszystkie przepisy
        </button>
        {canEdit && (
          <button
            onClick={async () => {
              if (confirm(`Usunąć „${r.title}”?`)) {
                await del.mutateAsync(r.id)
                nav('/')
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', font: "500 13px 'Hanken Grotesk'", marginBottom: 14 }}
          >
            <TrashIcon /> Usuń
          </button>
        )}
      </div>

      <div style={{ position: 'relative', height: 'clamp(150px, 32vw, 200px)', borderRadius: 18, background: gradient(r.tint), display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {r.imageUrl ? (
          <img src={r.imageUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontFamily: "'Spectral', serif", fontSize: 96, fontWeight: 500, color: 'rgba(255,255,255,.92)', lineHeight: 1 }}>
            {r.title[0]}
          </span>
        )}
        <span style={{ position: 'absolute', top: 16, left: 16, font: "700 10px 'Hanken Grotesk'", letterSpacing: '.08em', padding: '5px 9px', borderRadius: 7, background: 'rgba(255,255,255,.92)', color: sourceBadge[r.source].col }}>
          {sourceBadge[r.source].label}
        </span>
        {canEdit && <PhotoControls recipeId={r.id} />}
      </div>

      <PhotoGallery recipeId={r.id} images={r.images} canEdit={canEdit} />

      <h1 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 34, lineHeight: 1.08, margin: '22px 0 10px' }}>{r.title}</h1>
      <p style={{ fontSize: 15.5, lineHeight: 1.55, color: 'var(--text-2)', margin: '0 0 18px', maxWidth: '62ch' }}>{r.blurb}</p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <Pill>
          <ClockIcon size={15} color="var(--accent)" /> {r.time} min
        </Pill>
        <Pill>
          <ServingsIcon size={15} color="var(--accent)" /> Porcje: {r.servings}
        </Pill>
        <Pill>{r.difficulty}</Pill>
        {r.dishType && <Pill>{dishTypeLabel[r.dishType]}</Pill>}
        {r.cuisine && <Pill>Kuchnia {cuisineLabel[r.cuisine]}</Pill>}
        {r.usesAirFryer && (
          <Pill>
            <span style={{ color: 'var(--gold)' }}>★</span> Frytkownica
          </Pill>
        )}
      </div>

      <MacroPanel kcal={r.kcal} protein={r.protein} fat={r.fat} carbs={r.carbs} />

      {r.steps.length > 0 && (
        <button
          onClick={() => setCookMode(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 9, border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 12, padding: '13px 22px', font: "700 14.5px 'Hanken Grotesk'", cursor: 'pointer', boxShadow: '0 6px 18px rgba(160,66,32,.26)', margin: '0 0 28px', minHeight: 48 }}
        >
          <PlayIcon /> Gotuj krok po kroku
        </button>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.35fr', gap: 34, alignItems: 'start' }}>
        <div>
          <h2 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 20, margin: '0 0 13px' }}>Składniki</h2>
          <div style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 11, padding: '11px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ font: "500 12.5px 'Hanken Grotesk'", color: 'var(--accent-deep)', lineHeight: 1.35 }}>{haveSummary}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {r.ingredients.map((ing, i) => {
              const detail = ingredientDetailText(ing.displayText, ing.quantity)
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 2px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ flex: '0 0 9px', width: 9, height: 9, borderRadius: '50%', background: statusColor(ing.status) }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {ing.name}
                    {detail && <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, fontWeight: 400, color: 'var(--text-3)' }}>{detail}</span>}
                  </span>
                  {ing.quantity && <span style={{ flex: '0 0 auto', font: "500 12px 'Spline Sans Mono'", color: 'var(--text-2)', textAlign: 'right' }}>{ing.quantity}</span>}
                </div>
              )
            })}
          </div>
          {canEdit && r.missing.length > 0 && (
            <button
              onClick={async () => {
                await addMissing.mutateAsync(r.id)
                nav('/shopping')
              }}
              style={{ marginTop: 14, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 11, padding: 11, font: "600 13.5px 'Hanken Grotesk'", cursor: 'pointer' }}
            >
              <PlusIcon /> Dodaj {r.missing.length} brakujące do zakupów
            </button>
          )}
        </div>

        <div>
          <h2 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 20, margin: '0 0 15px' }}>Przygotowanie</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {r.steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 14 }}>
                <div style={{ flex: '0 0 28px', height: 28, borderRadius: '50%', background: 'var(--surface)', border: '1.5px solid var(--accent)', color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 13px 'Spectral', serif" }}>
                  {i + 1}
                </div>
                <p style={{ margin: '2px 0 0', fontSize: 14.5, lineHeight: 1.6, color: 'var(--text)' }}>{step}</p>
              </div>
            ))}
          </div>
          {r.tip && (
            <div style={{ marginTop: 22, background: '#f4efe1', border: '1px solid var(--border)', borderLeft: '3px solid var(--gold)', borderRadius: '0 11px 11px 0', padding: '14px 16px' }}>
              <div style={{ font: "700 11px 'Hanken Grotesk'", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 5 }}>Wskazówka</div>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text)' }}>{r.tip}</p>
            </div>
          )}
        </div>
      </div>

      <CookLogSection recipeId={r.id} initialOpen={cookRequested && canEdit} canEdit={canEdit} />

      {cookMode && (
        <CookMode title={r.title} steps={r.steps} ingredients={r.ingredients} onClose={() => setCookMode(false)} />
      )}
    </div>
  )
}

/**
 * Per-serving nutrition card: kcal, macro grams with colored dots, and a
 * calorie-share bar (protein/carbs 4 kcal per gram, fat 9). The bar renders
 * only when all three macros are estimated; partial data shows just the numbers.
 */
function MacroPanel({ kcal, protein, fat, carbs }: {
  kcal: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
}) {
  if (kcal == null && protein == null && fat == null && carbs == null) return null

  const defs = [
    { label: 'Białko', grams: protein, color: 'var(--sage)', kcalPerGram: 4 },
    { label: 'Tłuszcze', grams: fat, color: 'var(--gold)', kcalPerGram: 9 },
    { label: 'Węglowodany', grams: carbs, color: 'var(--accent)', kcalPerGram: 4 },
  ].filter((d): d is typeof d & { grams: number } => d.grams != null)
  const kcalTotal = defs.reduce((sum, d) => sum + d.grams * d.kcalPerGram, 0)

  const value: CSSProperties = { fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 'clamp(21px, 4.5vw, 26px)', lineHeight: 1 }
  const label: CSSProperties = { font: "600 10px 'Hanken Grotesk'", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-3)' }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px 13px', margin: '0 0 20px', maxWidth: 600 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: '14px 22px', marginBottom: 13 }}>
        {kcal != null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 22, borderRight: '1px solid var(--border)' }}>
            <span style={{ ...value, color: 'var(--accent-deep)' }}>~{kcal}</span>
            <span style={label}>kcal</span>
          </div>
        )}
        {defs.map((d) => (
          <div key={d.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...value, color: 'var(--text)' }}>{formatGrams(d.grams)}</span>
            <span style={{ ...label, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ flex: '0 0 7px', width: 7, height: 7, borderRadius: '50%', background: d.color }} />
              {d.label}
            </span>
          </div>
        ))}
      </div>
      {defs.length === 3 && kcalTotal > 0 && (
        <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--border)' }}>
          {defs.map((d) => (
            <span key={d.label} style={{ width: `${((d.grams * d.kcalPerGram) / kcalTotal) * 100}%`, background: d.color, height: '100%' }} />
          ))}
        </div>
      )}
      <div style={{ font: "500 11px 'Hanken Grotesk'", color: 'var(--text-3)', marginTop: 9 }}>na porcję · wartości szacunkowe</div>
    </div>
  )
}

function PhotoControls({ recipeId }: { recipeId: string }) {
  const upload = useUploadRecipeImage()
  const fileRef = useRef<HTMLInputElement>(null)

  const pill: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    border: 'none',
    background: 'rgba(255,255,255,.92)',
    color: 'var(--text)',
    borderRadius: 8,
    padding: '6px 11px',
    font: "600 11.5px 'Hanken Grotesk'",
    cursor: 'pointer',
  }

  async function onPick(file: File | undefined) {
    if (!file) return
    try {
      await upload.mutateAsync({ id: recipeId, file })
    } catch {
      alert('Nie udało się przesłać zdjęcia (JPG/PNG/WebP, maks. 5 MB).')
    }
  }

  return (
    <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', gap: 7 }}>
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
      <button onClick={() => fileRef.current?.click()} style={pill} disabled={upload.isPending}>
        <CameraIcon /> {upload.isPending ? 'Przesyłanie…' : 'Dodaj zdjęcie'}
      </button>
    </div>
  )
}

/** Thumbnails of every uploaded photo; click promotes one to the hero, ✕ removes it (read-only: view only). */
function PhotoGallery({ recipeId, images, canEdit }: { recipeId: string; images: RecipeImage[]; canEdit: boolean }) {
  const setDefault = useSetDefaultRecipeImage()
  const del = useDeleteRecipeImage()
  if (images.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 11 }}>
      {images.map((img) => (
        <div key={img.id} style={{ position: 'relative' }}>
          <img
            src={img.url}
            alt=""
            title={canEdit ? (img.isDefault ? 'Zdjęcie główne' : 'Ustaw jako główne') : undefined}
            onClick={() => canEdit && !img.isDefault && setDefault.mutate({ id: recipeId, imageId: img.id })}
            style={{
              display: 'block',
              width: 86,
              height: 62,
              objectFit: 'cover',
              borderRadius: 9,
              cursor: canEdit && !img.isDefault ? 'pointer' : 'default',
              border: img.isDefault ? '2px solid var(--accent)' : '2px solid var(--border)',
              opacity: img.isDefault ? 1 : 0.82,
            }}
          />
          {canEdit && <button
            onClick={() => del.mutate({ id: recipeId, imageId: img.id })}
            title="Usuń zdjęcie"
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              width: 19,
              height: 19,
              borderRadius: '50%',
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              font: "600 10px 'Hanken Grotesk'",
              lineHeight: 1,
            }}
          >
            ✕
          </button>}
        </div>
      ))}
    </div>
  )
}

const SKIP_REASON_PL: Record<string, string> = {
  unlinked: 'brak dopasowania w spiżarni',
  unparsed: 'nieprzeliczalna ilość',
  'unit-mismatch': 'inna jednostka',
}

/** Editable checkbox+amount state for one proposal row of the cook dialog. */
type DeductionRow = { checked: boolean; amount: string }

function parseAmount(s: string): number | null {
  if (!s.trim()) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function CookLogSection({ recipeId, initialOpen = false, canEdit }: { recipeId: string; initialOpen?: boolean; canEdit: boolean }) {
  const { data: entries } = useCookLog(recipeId)
  const add = useAddCookLog()
  const del = useDeleteCookLog()
  const [open, setOpen] = useState(initialOpen)
  const [rating, setRating] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const { data: proposal } = useCookProposal(recipeId, open)
  const [rows, setRows] = useState<Record<string, DeductionRow> | null>(null)

  // Pre-fill once per dialog opening: deductible rows checked with the recipe amount.
  useEffect(() => {
    if (!open) {
      setRows(null)
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

  const starBtn = (active: boolean): CSSProperties => ({
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 22,
    lineHeight: 1,
    padding: '0 2px',
    color: active ? 'var(--gold)' : 'var(--border-2)',
  })

  return (
    <div style={{ marginTop: 34 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 13 }}>
        <h2 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 20, margin: 0 }}>Historia gotowania</h2>
        <div style={{ flex: 1 }} />
        {canEdit && !open && (
          <button
            onClick={() => setOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 15px', font: "600 13px 'Hanken Grotesk'", cursor: 'pointer' }}
          >
            Ugotowane!
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 14px', maxWidth: '62ch' }}>
        Oceny i notatki trafiają do cooklog.md — asystent uczy się z nich, co u Was działa.
      </p>

      {open && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 13, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ font: "600 13px 'Hanken Grotesk'", color: 'var(--text)', marginBottom: 4 }}>Odejmij ze spiżarni</div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 10px' }}>
            Zaznaczone ilości zejdą ze stanu spiżarni (nie zejdzie poniżej zera). Popraw, jeśli zużyliście mniej lub więcej.
          </p>
          {!proposal || !rows ? (
            <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '6px 0 12px' }}>Ładowanie…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 14 }}>
              {proposal.items.map((it) => (
                <DeductionRowView
                  key={it.ingredientId}
                  item={it}
                  row={rows[it.ingredientId]}
                  onChange={(row) => setRows({ ...rows, [it.ingredientId]: row })}
                />
              ))}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ font: "500 13px 'Hanken Grotesk'", color: 'var(--text-2)' }}>Jak wyszło?</span>
            <div>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} style={starBtn(rating !== null && n <= rating)} onClick={() => setRating(rating === n ? null : n)}>
                  ★
                </button>
              ))}
            </div>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSave()}
            placeholder="Notatka — np. następnym razem mniej soli, dzieciaki zachwycone…"
            autoFocus
            style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 9, padding: '8px 11px', font: "400 13.5px 'Hanken Grotesk'", color: 'var(--text)', marginBottom: 11 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onSave}
              style={{ border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 9, padding: '7px 14px', font: "600 12.5px 'Hanken Grotesk'", cursor: 'pointer' }}
            >
              {add.isPending ? 'Zapisywanie…' : 'Zapisz'}
            </button>
            <button
              onClick={() => setOpen(false)}
              style={{ border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', borderRadius: 9, padding: '7px 14px', font: "500 12.5px 'Hanken Grotesk'", cursor: 'pointer' }}
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {entries && entries.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {entries.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 2px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ font: "500 12px 'Spline Sans Mono'", color: 'var(--text-3)', flex: '0 0 84px' }}>{e.cookedAt}</span>
              {e.rating !== null && (
                <span style={{ color: 'var(--gold)', fontSize: 13, flex: '0 0 auto', letterSpacing: 1 }}>
                  {'★'.repeat(e.rating)}
                  <span style={{ color: 'var(--border-2)' }}>{'★'.repeat(5 - e.rating)}</span>
                </span>
              )}
              <span style={{ flex: 1, fontSize: 13.5, color: e.note ? 'var(--text)' : 'var(--text-3)' }}>{e.note || 'bez notatki'}</span>
              {canEdit && (
                <button
                  onClick={() => del.mutate(e.id)}
                  title="Usuń wpis"
                  style={{ border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: 13 }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13.5, color: 'var(--text-3)' }}>Jeszcze nie gotowaliście z tego przepisu.</div>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', borderBottom: '1px solid var(--border)', opacity: canDeduct ? 1 : 0.55 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!canDeduct}
        onChange={(e) => onChange({ checked: e.target.checked, amount: row?.amount ?? '' })}
        style={{ accentColor: 'var(--accent)', width: 15, height: 15, cursor: canDeduct ? 'pointer' : 'default' }}
      />
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
        {item.name}
        {detail
          ? <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: 'var(--text-3)', marginTop: 2 }}>{detail}</span>
          : item.quantityText && <span style={{ font: "500 11.5px 'Spline Sans Mono'", color: 'var(--text-3)', marginLeft: 7 }}>{item.quantityText}</span>}
      </span>
      {!canDeduct ? (
        <span style={{ font: "500 11.5px 'Hanken Grotesk'", color: 'var(--text-3)', fontStyle: 'italic' }}>
          {SKIP_REASON_PL[item.skipReason ?? ''] ?? 'pominięte'}
        </span>
      ) : (
        <>
          {item.skipReason && (
            <span style={{ font: "500 11px 'Hanken Grotesk'", color: 'var(--gold)' }}>
              {SKIP_REASON_PL[item.skipReason]}
            </span>
          )}
          <input
            value={row?.amount ?? ''}
            disabled={!checked}
            onChange={(e) => onChange({ checked, amount: e.target.value })}
            inputMode="decimal"
            placeholder="0"
            style={{ width: 62, textAlign: 'right', border: '1px solid var(--border)', background: checked ? 'var(--surface)' : 'transparent', borderRadius: 8, padding: '5px 8px', font: "500 12.5px 'Spline Sans Mono'", color: 'var(--text)' }}
          />
          <span style={{ font: "500 12px 'Hanken Grotesk'", color: 'var(--text-2)', width: 30 }}>
            {item.unit ? unitLabel[item.unit] : ''}
          </span>
          <span style={{ font: "500 11px 'Spline Sans Mono'", color: 'var(--text-3)', width: 108, textAlign: 'right' }}>
            {item.pantryQuantity != null && item.unit ? `w domu: ${formatQty(item.pantryQuantity, item.unit)}` : ''}
          </span>
        </>
      )}
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 13px', font: "500 13px 'Hanken Grotesk'", color: 'var(--text)' }}>
      {children}
    </div>
  )
}
