import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { errorText, loginUrl } from '../api/client'
import { useAuth, useImportSharedRecipe, useSharedRecipe } from '../api/hooks'
import { RecipeThumb } from '../components/RecipeThumb'
import { Button, Chip, Eyebrow, SectionHead, mono, sans, usePagePad } from '../components/ui'
import { ingredientDetailText } from '../lib/ingredients'
import { dishLine, formatGrams, plural, sourceEyebrow } from '../lib/labels'
import { showToast } from '../lib/toastBus'
import { useIsMobile } from '../lib/useIsMobile'

/**
 * Public/cross-household share view (/s/:token). Readable without signing in; signed-in members
 * of another household can clone an independent copy into their own cookbook in one click.
 */
export function SharedRecipePage() {
  const { token } = useParams()
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { canEdit } = useAuth()
  const { data: r, isLoading, isError } = useSharedRecipe(token)
  const importRecipe = useImportSharedRecipe()
  const [importError, setImportError] = useState<string | null>(null)

  async function onImport() {
    if (!token) return
    setImportError(null)
    try {
      const created = await importRecipe.mutateAsync(token)
      showToast(`Zapisano przepis „${created.title}” w Twojej książce.`)
      nav(`/recipe/${created.id}`)
    } catch (err) {
      setImportError(errorText(err, 'Nie udało się zapisać przepisu.'))
    }
  }

  if (isLoading) {
    return <div style={{ ...pad, color: 'var(--text-3)', font: sans(14.5) }}>Ładowanie przepisu…</div>
  }

  if (isError || !r) {
    return (
      <div style={{ ...pad, maxWidth: 560, margin: '36px auto', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
        <Eyebrow tone="accent">Udostępniony przepis</Eyebrow>
        <h1 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 32 }}>Link wygasł lub jest nieprawidłowy</h1>
        <p style={{ margin: 0, font: sans(15), lineHeight: 1.5, color: 'var(--text-2)' }}>
          Ten link do udostępnionego przepisu został cofnięty albo minął termin jego ważności. Poproś nadawcę o nowy link.
        </p>
        <Button variant="outline" onClick={() => nav('/')}>Przejdź do Pichci</Button>
      </div>
    )
  }

  const eyebrow = [dishLine(r), r.usesAirFryer ? 'frytkownica' : ''].filter(Boolean).join(' · ')
  const returnPath = `/s/${encodeURIComponent(r.token)}`

  const cta = r.isOwnHousehold && r.ownRecipeId ? (
    <Button variant="outline" size={isMobile ? 'sm' : 'md'} onClick={() => nav(`/recipe/${r.ownRecipeId}`)}>
      {isMobile ? 'Otwórz w książce ›' : 'Otwórz w Twojej książce ›'}
    </Button>
  ) : canEdit ? (
    <Button size={isMobile ? 'sm' : 'md'} disabled={importRecipe.isPending} onClick={onImport}>
      {importRecipe.isPending ? 'Zapisywanie…' : isMobile ? 'Zapisz u siebie' : 'Zapisz do mojej książki'}
    </Button>
  ) : (
    <Button size={isMobile ? 'sm' : 'md'} onClick={() => { window.location.href = loginUrl(returnPath) }}>
      {isMobile ? 'Zaloguj, aby zapisać' : 'Zaloguj się, aby zapisać'}
    </Button>
  )

  return (
    <div style={{ ...pad, maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 24, paddingBottom: 72 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: isMobile ? 12 : 14,
          flexWrap: 'wrap',
          // Phones: one ruled line instead of a card.
          ...(isMobile
            ? { padding: '10px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--border)' }
            : { padding: '14px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border-2)' }),
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 2 : 3, minWidth: 0 }}>
          {isMobile ? (
            <span style={{ font: sans(13.5, 500), color: 'var(--text-2)' }}>
              Udostępnił dom <strong style={{ color: 'var(--text)' }}>{r.sharedByHousehold}</strong>
              {r.isOwnHousehold && <span style={{ color: 'var(--text-3)' }}> (Twój)</span>}
            </span>
          ) : (
            <>
              <Eyebrow tone="accent">Udostępniony przepis · Pichci</Eyebrow>
              <span style={{ font: sans(14.5, 500), color: 'var(--text)' }}>
                Od: <strong>{r.sharedByHousehold}</strong>
                {r.isOwnHousehold && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> (Twój dom)</span>}
              </span>
            </>
          )}
          {importError && <span style={{ font: sans(13), color: 'var(--accent-text)' }}>{importError}</span>}
        </div>
        {cta}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) minmax(0,1fr)', gap: isMobile ? 20 : 36, alignItems: 'start' }}>
        <div style={{ position: 'relative' }}>
          <RecipeThumb r={{ imageUrl: r.imageUrl, tint: r.tint, title: r.title }} full letterSize={96} style={{ height: isMobile ? 260 : 340, borderRadius: 16 }} />
          <span style={{ position: 'absolute', left: 14, top: 14, font: mono(10.5, 500), letterSpacing: '.1em', textTransform: 'uppercase', padding: '5px 8px', borderRadius: 5, background: 'var(--surface)' }}>
            {sourceEyebrow(r)}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {eyebrow && <Eyebrow tone="accent">{eyebrow}</Eyebrow>}
          <h1 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 32 : 42, lineHeight: 1.05, letterSpacing: '-0.025em' }}>
            {r.title}
          </h1>
          {r.blurb && <p style={{ margin: 0, font: sans(15), lineHeight: 1.5, color: 'var(--text-2)' }}>{r.blurb}</p>}
          {r.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {r.tags.map((t) => <Chip key={t}>#{t}</Chip>)}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
            {[
              [String(r.time), 'minut'],
              [String(r.servings), plural(r.servings, 'porcja', 'porcje', 'porcji').replace(/^\d+ /, '')],
              [r.kcal != null ? `~${r.kcal}` : '—', 'kcal / porcję'],
              [r.difficulty, 'poziom'],
            ].map(([val, lbl], idx) => (
              <div key={lbl} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: idx === 0 ? '10px 0' : '10px 0 10px 12px', borderLeft: idx === 0 ? 0 : '1px solid var(--border)' }}>
                <span style={{ font: mono(17, 500) }}>{val}</span>
                <span style={{ font: sans(11.5), color: 'var(--text-2)' }}>{lbl}</span>
              </div>
            ))}
          </div>

          {(r.protein != null || r.fat != null || r.carbs != null) && (
            <span style={{ font: mono(12.5), color: 'var(--text-2)' }}>
              {[
                r.protein != null ? `B ${formatGrams(r.protein)}` : null,
                r.fat != null ? `T ${formatGrams(r.fat)}` : null,
                r.carbs != null ? `W ${formatGrams(r.carbs)}` : null,
              ].filter(Boolean).join(' · ')} (na 1 porcję)
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) minmax(0,1.25fr)', gap: isMobile ? 24 : 36, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <SectionHead title="Składniki" size={22} meta={`na ${plural(r.servings, 'porcję', 'porcje', 'porcji')}`} />
          {r.ingredients.map((ing, i) => {
            const detail = ingredientDetailText(ing.displayText, ing.quantity)
            const followsAlt = Boolean(ing.alternativeGroup && r.ingredients[i - 1]?.alternativeGroup === ing.alternativeGroup)
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', font: sans(15) }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {followsAlt && <span style={{ font: mono(11), color: 'var(--text-3)', marginRight: 6 }}>lub</span>}
                  <span>{ing.name}</span>
                  {detail && <span style={{ display: 'block', font: sans(12.5), color: 'var(--text-3)', marginTop: 2 }}>{detail}</span>}
                </span>
                {ing.quantity && <span style={{ font: mono(13), color: 'var(--text-2)', flexShrink: 0 }}>{ing.quantity}</span>}
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionHead title="Przygotowanie" size={22} meta={plural(r.steps.length, 'krok', 'kroki', 'kroków')} />
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
            {r.steps.map((step, i) => (
              isMobile ? (
                <li key={i} style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ flex: '0 0 22px', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 24, lineHeight: 1, color: 'var(--accent-text)' }}>{i + 1}</span>
                  <span style={{ font: sans(15), lineHeight: 1.5 }}>{step}</span>
                </li>
              ) : (
                <li key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ font: mono(13, 500), color: 'var(--text-3)' }}>{i + 1}.</span>
                  <span style={{ font: sans(15), lineHeight: 1.55 }}>{step}</span>
                </li>
              )
            ))}
          </ol>
          {r.tip && (isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, padding: '14px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--border)' }}>
              <Eyebrow tone="accent">Wskazówka</Eyebrow>
              <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 17, lineHeight: 1.5, color: 'var(--text)' }}>{r.tip}</span>
            </div>
          ) : (
            <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <Eyebrow tone="muted">Wskazówka</Eyebrow>
              <p style={{ margin: '6px 0 0', font: sans(14.5), lineHeight: 1.5, color: 'var(--text-2)' }}>{r.tip}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
