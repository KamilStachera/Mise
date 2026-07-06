import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateRecipe, useUploadRecipeImage } from '../api/hooks'
import type { Cuisine, DishType, RecipeInput, Source } from '../api/client'
import { CUISINES, DISH_TYPES, cuisineLabel, dishTypeLabel } from '../lib/labels'
import { BackIcon, PlusIcon, TrashIcon, CameraIcon } from '../components/icons'
import { IMAGE_ACCEPT } from '../lib/images'

type Ing = { name: string; quantity: string }

const input: CSSProperties = {
  width: '100%',
  border: '1px solid var(--border)',
  background: 'var(--card)',
  borderRadius: 10,
  padding: '10px 13px',
  font: "400 14px 'Hanken Grotesk'",
  color: 'var(--text)',
}
const label: CSSProperties = {
  font: "600 11px 'Hanken Grotesk'",
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  marginBottom: 6,
  display: 'block',
}

export function AddRecipe() {
  const nav = useNavigate()
  const create = useCreateRecipe()
  const uploadImage = useUploadRecipeImage()

  const [paste, setPaste] = useState('')
  const [title, setTitle] = useState('')
  const [source, setSource] = useState<Source>('ai')
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
  const [ings, setIngs] = useState<Ing[]>([{ name: '', quantity: '' }])
  const [steps, setSteps] = useState<string[]>([''])
  const [photo, setPhoto] = useState<File | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  const photoPreview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
  }, [photoPreview])

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
      time,
      servings,
      difficulty,
      tint,
      blurb: blurb.trim(),
      tip: tip.trim() || undefined,
      ingredients: ings.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), quantity: i.quantity.trim() })),
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

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '26px 42px 70px' }}>
      <button onClick={() => nav('/')} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', font: "500 13.5px 'Hanken Grotesk'", padding: '6px 0', marginBottom: 14 }}>
        <BackIcon /> Wszystkie przepisy
      </button>

      <div style={{ font: "600 11px 'Hanken Grotesk'", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 7 }}>Nowy przepis</div>
      <h1 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 34, margin: '0 0 18px' }}>Dodaj przepis</h1>

      {/* Wklej z AI */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 26 }}>
        <label style={label}>Wklej z AI / skądkolwiek</label>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={'Wklej przepis (np. z ChatGPT) i kliknij Przetwórz.\nNajlepiej działa z nagłówkami „Składniki" i „Przygotowanie".'}
          style={{ ...input, minHeight: 120, resize: 'vertical', lineHeight: 1.5, fontFamily: "'Spline Sans Mono', monospace", fontSize: 12.5 }}
        />
        <button onClick={applyParsed} disabled={!paste.trim()} style={{ marginTop: 10, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 10, padding: '9px 16px', cursor: paste.trim() ? 'pointer' : 'not-allowed', font: "600 13px 'Hanken Grotesk'", opacity: paste.trim() ? 1 : 0.5 }}>
          Przetwórz do formularza ↓
        </button>
      </div>

      {/* Formularz */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={label}>Tytuł</label>
          <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="np. Chrupiące gnocchi z frytkownicy" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={label}>Źródło</label>
            <select style={input} value={source} onChange={(e) => setSource(e.target.value as Source)}>
              <option value="ai">Od AI</option>
              <option value="web">Sieć i książki</option>
              <option value="manual">Moje własne</option>
            </select>
          </div>
          <div>
            <label style={label}>Czas (min)</label>
            <input style={input} type="number" value={time} onChange={(e) => setTime(+e.target.value)} />
          </div>
          <div>
            <label style={label}>Porcje</label>
            <input style={input} type="number" value={servings} onChange={(e) => setServings(+e.target.value)} />
          </div>
          <div>
            <label style={label}>Trudność</label>
            <select style={input} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option>Łatwe</option>
              <option>Średnie</option>
              <option>Trudne</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={label}>Rodzaj dania</label>
            <select style={input} value={dishType} onChange={(e) => setDishType(e.target.value as DishType | '')}>
              <option value="">— brak —</option>
              {DISH_TYPES.map((d) => (
                <option key={d} value={d}>
                  {dishTypeLabel[d]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Kuchnia</label>
            <select style={input} value={cuisine} onChange={(e) => setCuisine(e.target.value as Cuisine | '')}>
              <option value="">— brak —</option>
              {CUISINES.map((c) => (
                <option key={c} value={c}>
                  {cuisineLabel[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Frytkownica</label>
            <select style={input} value={airFryer} onChange={(e) => setAirFryer(e.target.value as '' | 'yes' | 'no')}>
              <option value="">Auto (wykryj z tekstu)</option>
              <option value="yes">Tak</option>
              <option value="no">Nie</option>
            </select>
          </div>
        </div>

        <div>
          <label style={label}>Opis</label>
          <textarea style={{ ...input, minHeight: 60, resize: 'vertical', lineHeight: 1.5 }} value={blurb} onChange={(e) => setBlurb(e.target.value)} />
        </div>

        <div>
          <label style={label}>Składniki</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ings.map((ing, i) => (
              <div key={i} style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...input, flex: 1 }} value={ing.name} placeholder="składnik" onChange={(e) => setIngs((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input style={{ ...input, width: 130 }} value={ing.quantity} placeholder="ilość" onChange={(e) => setIngs((a) => a.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                <RemoveBtn onClick={() => setIngs((a) => (a.length > 1 ? a.filter((_, j) => j !== i) : a))} />
              </div>
            ))}
          </div>
          <AddBtn label="Dodaj składnik" onClick={() => setIngs((a) => [...a, { name: '', quantity: '' }])} />
        </div>

        <div>
          <label style={label}>Przygotowanie</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: '0 0 26px', height: 26, marginTop: 6, borderRadius: '50%', background: 'var(--surface)', border: '1.5px solid var(--accent)', color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 12px 'Spectral', serif" }}>{i + 1}</div>
                <textarea style={{ ...input, flex: 1, minHeight: 38, resize: 'vertical', lineHeight: 1.5 }} value={s} placeholder={`Krok ${i + 1}`} onChange={(e) => setSteps((a) => a.map((x, j) => (j === i ? e.target.value : x)))} />
                <RemoveBtn onClick={() => setSteps((a) => (a.length > 1 ? a.filter((_, j) => j !== i) : a))} />
              </div>
            ))}
          </div>
          <AddBtn label="Dodaj krok" onClick={() => setSteps((a) => [...a, ''])} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={label}>Wskazówka (opcjonalnie)</label>
            <input style={input} value={tip} onChange={(e) => setTip(e.target.value)} />
          </div>
          <div>
            <label style={label}>Zdjęcie (opcjonalnie)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
              <button
                onClick={() => photoRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', gap: 7, height: 42, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', borderRadius: 10, padding: '0 13px', font: "500 13px 'Hanken Grotesk'", cursor: 'pointer' }}
              >
                <CameraIcon /> {photo ? 'Zmień' : 'Wybierz'}
              </button>
              {photoPreview && (
                <>
                  <img src={photoPreview} alt="" style={{ width: 42, height: 42, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
                  <button onClick={() => setPhoto(null)} title="Usuń zdjęcie" style={{ border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: 13 }}>
                    ✕
                  </button>
                </>
              )}
            </div>
          </div>
          <div>
            <label style={label}>Kolor</label>
            <input type="color" value={tint} onChange={(e) => setTint(e.target.value)} style={{ width: 52, height: 42, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', cursor: 'pointer' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button onClick={submit} disabled={create.isPending} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 11, padding: '12px 22px', cursor: 'pointer', font: "600 14px 'Hanken Grotesk'" }}>
            {create.isPending ? 'Zapisywanie…' : 'Zapisz przepis'}
          </button>
          <button onClick={() => nav('/')} style={{ border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', borderRadius: 11, padding: '12px 22px', cursor: 'pointer', font: "500 14px 'Hanken Grotesk'" }}>
            Anuluj
          </button>
        </div>
      </div>
    </div>
  )
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, border: '1px dashed var(--border-2)', background: 'transparent', color: 'var(--text-2)', borderRadius: 9, padding: '8px 12px', cursor: 'pointer', font: "500 13px 'Hanken Grotesk'" }}>
      <PlusIcon size={14} /> {label}
    </button>
  )
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ flex: '0 0 40px', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text-3)', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <TrashIcon />
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
  const m = line.match(/^([\d¼½¾⅓⅔/.,]+\s*[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*\b)\s+(.{2,})$/)
  if (m && /\d/.test(m[1])) return { name: m[2].trim(), quantity: m[1].trim() }
  return { name: line, quantity: '' }
}
