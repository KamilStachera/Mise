import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useCreateRecipe, usePantry, useUploadRecipeImage } from '../api/hooks'
import { LoginPrompt } from '../components/LoginPrompt'
import type { Cuisine, DishType, RecipeInput, Source } from '../api/client'
import { CUISINES, DIFFICULTIES, DISH_TYPES, cuisineLabel, dishTypeLabel, sourceLabel } from '../lib/labels'
import { IMAGE_ACCEPT } from '../lib/images'
import { useIsMobile } from '../lib/useIsMobile'
import { TAB_BAR_HEIGHT } from '../components/TabBar'
import { Button, Chip, Eyebrow, PageTitle, inputStyle, mono, sans, usePagePad } from '../components/ui'

type Ing = { name: string; quantity: string; displayText: string; alternativeGroup: string }

const SOURCES: Source[] = ['ai', 'web', 'manual']
const select: CSSProperties = { ...inputStyle, cursor: 'pointer' }

export function AddRecipe() {
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { canEdit, isLoading: authLoading } = useAuth()
  const create = useCreateRecipe()
  const uploadImage = useUploadRecipeImage()
  const { data: pantry } = usePantry()

  const [paste, setPaste] = useState('')
  const [title, setTitle] = useState('')
  const [source, setSource] = useState<Source>('ai')
  const [sourceName, setSourceName] = useState('')
  const [time, setTime] = useState(30)
  const [servings, setServings] = useState(2)
  const [difficulty, setDifficulty] = useState('Łatwe')
  const [dishType, setDishType] = useState<DishType | ''>('')
  const [cuisine, setCuisine] = useState<Cuisine | ''>('')
  // '' = auto: backend detects the air-fryer from the recipe text.
  const [airFryer, setAirFryer] = useState<'' | 'yes' | 'no'>('')
  const [tint, setTint] = useState('#c0552d')
  const [blurb, setBlurb] = useState('')
  const [tip, setTip] = useState('')
  const [ings, setIngs] = useState<Ing[]>([{ name: '', quantity: '', displayText: '', alternativeGroup: '' }])
  const [steps, setSteps] = useState<string[]>([''])
  const [photo, setPhoto] = useState<File | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  const photoPreview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  const pantryNames = useMemo(
    () => (pantry ?? []).flatMap((group) => group.items.map((item) => item.name)),
    [pantry],
  )
  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
  }, [photoPreview])

  // After all hooks (rules of hooks). Adding recipes is edit-only.
  if (authLoading) return null
  if (!canEdit) return <LoginPrompt title="Dodawanie przepisów wymaga zalogowania" />

  function applyParsed() {
    const p = parseRecipe(paste)
    if (p.title) setTitle(p.title)
    if (p.blurb) setBlurb(p.blurb)
    if (p.ingredients.length) setIngs(p.ingredients)
    if (p.steps.length) setSteps(p.steps)
  }

  async function submit() {
    const payload: RecipeInput = {
      title: title.trim() || 'Przepis bez nazwy',
      source,
      sourceName: sourceName.trim() || undefined,
      time,
      servings,
      difficulty,
      tint,
      blurb: blurb.trim(),
      tip: tip.trim() || undefined,
      ingredients: ings.filter((i) => i.name.trim()).map((i) => ({
        name: i.name.trim(),
        quantity: i.quantity.trim(),
        displayText: i.displayText.trim() || undefined,
        alternativeGroup: i.alternativeGroup.trim() || undefined,
      })),
      steps: steps.map((s) => s.trim()).filter(Boolean),
      dishType: dishType || undefined,
      cuisine: cuisine || undefined,
      usesAirFryer: airFryer === '' ? undefined : airFryer === 'yes',
    }
    const { id } = await create.mutateAsync(payload)
    if (photo) {
      try {
        await uploadImage.mutateAsync({ id, file: photo })
      } catch {
        alert('Przepis zapisany, ale zdjęcie się nie przesłało (JPG/PNG/WebP, maks. 5 MB).')
      }
    }
    nav(`/recipe/${id}`)
  }

  const setIng = (i: number, patch: Partial<Ing>) => setIngs((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const cols = (desktop: string) => (isMobile ? '1fr' : desktop)
  const saveButtons = (
    <div style={{ display: 'flex', gap: 10 }}>
      <Button size={isMobile ? 'xl' : 'lg'} style={{ flex: isMobile ? 1.4 : undefined }} onClick={submit} disabled={create.isPending}>
        {create.isPending ? 'Zapisywanie…' : 'Zapisz przepis'}
      </Button>
      <Button variant="quiet" size={isMobile ? 'xl' : 'lg'} style={{ flex: isMobile ? 1 : undefined }} onClick={() => nav('/')}>Anuluj</Button>
    </div>
  )

  return (
    <div style={{ ...pad, paddingBottom: isMobile ? 110 : 64, maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 20 : 28 }}>
      <button type="button" onClick={() => nav('/')} style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: sans(14, 600), color: 'var(--text-2)' }}>
        ← Wszystkie przepisy
      </button>
      <PageTitle title="Dodaj przepis" size={isMobile ? 40 : undefined} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <Eyebrow>Wklej z AI / skądkolwiek</Eyebrow>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={'Wklej przepis (np. z ChatGPT) i kliknij Przetwórz.\nNajlepiej działa z nagłówkami „Składniki” i „Przygotowanie”.'}
          style={{ ...inputStyle, height: 'auto', minHeight: 120, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5, font: mono(12.5), background: 'var(--bg)' }}
        />
        <Button variant="dark" size="sm" style={{ alignSelf: 'flex-start' }} onClick={applyParsed} disabled={!paste.trim()}>Przetwórz do formularza ↓</Button>
      </div>

      <Section title="Podstawy">
        <Field label="Tytuł">
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="np. Chrupiące gnocchi z frytkownicy" />
        </Field>
        <Field label="Skąd przepis">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SOURCES.map((s) => <Chip key={s} active={source === s} onClick={() => setSource(s)}>{sourceLabel[s]}</Chip>)}
          </div>
        </Field>
        <Field label="Źródło (nazwa, opcjonalnie)" hint="Książka, strona albo jadłospis — pokazujemy je nad tytułem na kartach.">
          <input style={inputStyle} value={sourceName} maxLength={80} onChange={(e) => setSourceName(e.target.value)} placeholder="np. Daily Dieta, Jadłonomia" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <Field label="Czas (min)">
            <input style={{ ...inputStyle, font: mono(15) }} type="number" min={1} value={time} onChange={(e) => setTime(+e.target.value)} />
          </Field>
          <Field label="Porcje">
            <input style={{ ...inputStyle, font: mono(15) }} type="number" min={1} value={servings} onChange={(e) => setServings(+e.target.value)} />
          </Field>
          <Field label="Trudność">
            <select style={select} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: cols('repeat(3, minmax(0, 1fr))'), gap: 12 }}>
          <Field label="Rodzaj dania">
            <select style={select} value={dishType} onChange={(e) => setDishType(e.target.value as DishType | '')}>
              <option value="">— brak —</option>
              {DISH_TYPES.map((d) => <option key={d} value={d}>{dishTypeLabel[d]}</option>)}
            </select>
          </Field>
          <Field label="Kuchnia">
            <select style={select} value={cuisine} onChange={(e) => setCuisine(e.target.value as Cuisine | '')}>
              <option value="">— brak —</option>
              {CUISINES.map((c) => <option key={c} value={c}>{cuisineLabel[c]}</option>)}
            </select>
          </Field>
          <Field label="Frytkownica">
            <select style={select} value={airFryer} onChange={(e) => setAirFryer(e.target.value as '' | 'yes' | 'no')}>
              <option value="">Auto (wykryj z tekstu)</option>
              <option value="yes">Tak</option>
              <option value="no">Nie</option>
            </select>
          </Field>
        </div>
        <Field label="Opis">
          <textarea style={{ ...inputStyle, height: 'auto', minHeight: 72, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }} value={blurb} onChange={(e) => setBlurb(e.target.value)} />
        </Field>
      </Section>

      <Section title="Składniki">
        <datalist id="pantry-ingredient-names">
          {pantryNames.map((name) => <option key={name} value={name} />)}
        </datalist>
        {ings.map((ing, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr) 96px 44px' : 'minmax(150px,.8fr) 110px minmax(200px,1.4fr) 100px 44px', gap: 8, paddingBottom: isMobile ? 12 : 0, borderBottom: isMobile ? '1px solid var(--border)' : 0 }}>
            <input list="pantry-ingredient-names" style={inputStyle} value={ing.name} placeholder="produkt w spiżarni" onChange={(e) => setIng(i, { name: e.target.value })} />
            <input style={inputStyle} value={ing.quantity} placeholder="ilość" onChange={(e) => setIng(i, { quantity: e.target.value })} />
            {isMobile && <RemoveBtn onClick={() => setIngs((a) => (a.length > 1 ? a.filter((_, j) => j !== i) : a))} />}
            <input style={{ ...inputStyle, gridColumn: isMobile ? '1 / 3' : undefined }} value={ing.displayText} placeholder="pełny zapis, np. 2 kromki chleba na zakwasie" onChange={(e) => setIng(i, { displayText: e.target.value })} />
            <input style={inputStyle} value={ing.alternativeGroup} placeholder="grupa LUB" title="Ta sama wartość łączy zamienniki, np. spód" onChange={(e) => setIng(i, { alternativeGroup: e.target.value })} />
            {!isMobile && <RemoveBtn onClick={() => setIngs((a) => (a.length > 1 ? a.filter((_, j) => j !== i) : a))} />}
          </div>
        ))}
        <AddBtn label="Dodaj składnik" onClick={() => setIngs((a) => [...a, { name: '', quantity: '', displayText: '', alternativeGroup: '' }])} />
      </Section>

      <Section title="Przygotowanie">
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ flex: '0 0 22px', paddingTop: 10, fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 22, lineHeight: 1, color: 'var(--accent-text)' }}>{i + 1}</span>
            <textarea style={{ ...inputStyle, height: 'auto', flex: 1, minHeight: 46, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }} value={s} placeholder={`Krok ${i + 1}`} onChange={(e) => setSteps((a) => a.map((x, j) => (j === i ? e.target.value : x)))} />
            <RemoveBtn onClick={() => setSteps((a) => (a.length > 1 ? a.filter((_, j) => j !== i) : a))} />
          </div>
        ))}
        <AddBtn label="Dodaj krok" onClick={() => setSteps((a) => [...a, ''])} />
      </Section>

      <Section title="Na koniec">
        <Field label="Wskazówka (opcjonalnie)">
          <input style={inputStyle} value={tip} onChange={(e) => setTip(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Zdjęcie (opcjonalnie)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
              <Button variant="quiet" onClick={() => photoRef.current?.click()}>{photo ? 'Zmień zdjęcie' : 'Wybierz zdjęcie'}</Button>
              {photoPreview && (
                <>
                  <img src={photoPreview} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 10 }} />
                  <button type="button" onClick={() => setPhoto(null)} title="Usuń zdjęcie" style={{ border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </>
              )}
            </div>
          </Field>
          <Field label="Kolor karty (bez zdjęcia)">
            <input type="color" value={tint} onChange={(e) => setTint(e.target.value)} style={{ width: 56, height: 46, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', cursor: 'pointer', padding: 4 }} />
          </Field>
        </div>
      </Section>

      {isMobile ? (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`, zIndex: 20, padding: '10px 16px', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
          {saveButtons}
        </div>
      ) : (
        saveButtons
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 22, paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>{title}</span>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <Eyebrow>{label}</Eyebrow>
      {children}
      {hint && <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>{hint}</span>}
    </div>
  )
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ alignSelf: 'flex-start', height: 40, padding: '0 14px', border: '1px dashed var(--border-2)', borderRadius: 999, background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', font: sans(13.5, 600) }}>
      + {label}
    </button>
  )
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Usuń" style={{ width: 44, height: 46, flex: '0 0 44px', border: '1px solid var(--border)', borderRadius: 12, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: 14 }}>
      ✕
    </button>
  )
}

// Best-effort parse of pasted recipe text into structured fields (EN + PL headings).
function parseRecipe(text: string): { title: string; blurb: string; ingredients: Ing[]; steps: string[] } {
  const rawLines = text.split('\n').map((l) => l.trim())
  const lines = rawLines.filter((l) => l.length > 0)
  if (lines.length === 0) return { title: '', blurb: '', ingredients: [], steps: [] }

  const title = lines[0].replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim()

  const ingIdx = lines.findIndex((l) => /^#*\s*(ingredients|sk[łl]adniki)\b/i.test(l))
  const methodIdx = lines.findIndex((l) =>
    /^#*\s*(method|steps|instructions|directions|przygotowanie|spos[oó]b|wykonanie|kroki|instrukcje)\b/i.test(l),
  )

  const ingredients: Ing[] = []
  const steps: string[] = []

  if (ingIdx >= 0) {
    const end = methodIdx > ingIdx ? methodIdx : lines.length
    for (let i = ingIdx + 1; i < end; i++) ingredients.push(parseIngredient(stripBullet(lines[i])))
  }
  if (methodIdx >= 0) {
    for (let i = methodIdx + 1; i < lines.length; i++) {
      const s = stripBullet(lines[i])
      if (s) steps.push(s)
    }
  }

  // Fallback: no headings — treat short lines as ingredients, long/numbered as steps.
  if (ingIdx < 0 && methodIdx < 0) {
    for (const l of lines.slice(1)) {
      if (/^\d+[.)]\s/.test(l)) steps.push(stripBullet(l))
      else if (l.length < 60) ingredients.push(parseIngredient(stripBullet(l)))
      else steps.push(l)
    }
  }

  const blurb = ingIdx > 1 ? lines.slice(1, ingIdx).join(' ') : ''
  return { title, blurb, ingredients: ingredients.filter((i) => i.name), steps }
}

function stripBullet(s: string): string {
  return s.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').trim()
}

function parseIngredient(line: string): Ing {
  const m = line.match(/^([\d¼½¾⅓⅔/.,–-]+\s*[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*\b)\s+(.{2,})$/)
  if (m && /\d/.test(m[1])) return { name: m[2].trim(), quantity: m[1].trim(), displayText: line, alternativeGroup: '' }

  // Some recipe sites render ingredients as "product – amount" rather than
  // "amount product". Keep the source line, but put the amount in its own field.
  const reversed = line.match(/^(.{2,}?)\s+[–—-]\s+(.+)$/)
  if (reversed && /^(?:[\d¼½¾⅓⅔]|do smaku\b|według uznania\b|szczypta\b|garść\b)/i.test(reversed[2])) {
    return { name: reversed[1].trim(), quantity: reversed[2].trim(), displayText: line, alternativeGroup: '' }
  }
  return { name: line, quantity: '', displayText: line, alternativeGroup: '' }
}
