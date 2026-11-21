import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { usePantry, useRecipes } from '../api/hooks'
import type { Cuisine, DishType, RecipeDetail, RecipeInput, Source } from '../api/client'
import { CUISINES, DIFFICULTIES, DISH_TYPES, cuisineLabel, dishTypeLabel, sourceLabel } from '../lib/labels'
import { normalizeTag, parseOptionalDecimal, type RecipeFormIngredient } from '../lib/recipeParsing'
import { useIsMobile } from '../lib/useIsMobile'
import { TAB_BAR_HEIGHT } from './TabBar'
import { Button, Chip, Eyebrow, inputStyle, mono, sans } from './ui'

export interface RecipeFormValues {
  title: string
  source: Source
  sourceName: string
  time: number
  servings: number
  difficulty: string
  dishType: DishType | ''
  cuisine: Cuisine | ''
  airFryer: '' | 'yes' | 'no'
  tint: string
  blurb: string
  tip: string
  kcal: string
  protein: string
  fat: string
  carbs: string
  tags: string[]
  ings: RecipeFormIngredient[]
  steps: string[]
}

export function emptyRecipeForm(): RecipeFormValues {
  return {
    title: '',
    source: 'manual',
    sourceName: '',
    time: 30,
    servings: 2,
    difficulty: 'Łatwe',
    dishType: '',
    cuisine: '',
    airFryer: '',
    tint: '#c0552d',
    blurb: '',
    tip: '',
    kcal: '',
    protein: '',
    fat: '',
    carbs: '',
    tags: [],
    ings: [{ name: '', quantity: '', displayText: '', alternativeGroup: '' }],
    steps: [''],
  }
}

export function recipeDetailToForm(r: RecipeDetail): RecipeFormValues {
  return {
    title: r.title,
    source: r.source,
    sourceName: r.sourceName ?? '',
    time: r.time,
    servings: r.servings,
    difficulty: DIFFICULTIES.includes(r.difficulty) ? r.difficulty : 'Łatwe',
    dishType: r.dishType ?? '',
    cuisine: r.cuisine ?? '',
    airFryer: r.usesAirFryer ? 'yes' : 'no',
    tint: r.tint || '#c0552d',
    blurb: r.blurb ?? '',
    tip: r.tip ?? '',
    kcal: r.kcal != null ? String(r.kcal) : '',
    protein: r.protein != null ? String(r.protein).replace('.', ',') : '',
    fat: r.fat != null ? String(r.fat).replace('.', ',') : '',
    carbs: r.carbs != null ? String(r.carbs).replace('.', ',') : '',
    tags: r.tags ?? [],
    ings:
      r.ingredients.length > 0
        ? r.ingredients.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            displayText: i.displayText ?? '',
            alternativeGroup: i.alternativeGroup ?? '',
            amountValue: i.amountValue ?? null,
            amountUnit: i.amountUnit ?? null,
            originalQuantity: i.quantity,
          }))
        : [{ name: '', quantity: '', displayText: '', alternativeGroup: '' }],
    steps: r.steps.length > 0 ? [...r.steps] : [''],
  }
}

export function formToRecipeInput(v: RecipeFormValues): { payload?: RecipeInput; error?: string } {
  const title = v.title.trim()
  if (!title) return { error: 'Podaj tytuł przepisu.' }

  const kcal = parseOptionalDecimal(v.kcal)
  const protein = parseOptionalDecimal(v.protein)
  const fat = parseOptionalDecimal(v.fat)
  const carbs = parseOptionalDecimal(v.carbs)
  if (
    (v.kcal.trim() && (kcal === null || kcal <= 0)) ||
    (v.protein.trim() && (protein === null || protein < 0)) ||
    (v.fat.trim() && (fat === null || fat < 0)) ||
    (v.carbs.trim() && (carbs === null || carbs < 0))
  ) {
    return { error: 'Sprawdź wartości odżywcze (kcal > 0, białko/tłuszcz/węglowodany ≥ 0).' }
  }

  return {
    payload: {
      title,
      source: v.source,
      sourceName: v.sourceName.trim() || undefined,
      time: Number.isFinite(v.time) && v.time >= 0 ? Math.round(v.time) : 0,
      servings: Number.isFinite(v.servings) && v.servings >= 1 ? Math.round(v.servings) : 2,
      difficulty: v.difficulty,
      tint: v.tint,
      blurb: v.blurb.trim(),
      tip: v.tip.trim() || undefined,
      kcal: kcal != null ? Math.round(kcal) : undefined,
      protein: protein ?? undefined,
      fat: fat ?? undefined,
      carbs: carbs ?? undefined,
      tags: v.tags,
      ingredients: v.ings
        .filter((i) => i.name.trim())
        .map((i) => {
          const qty = i.quantity.trim()
          const keepStructured =
            i.originalQuantity !== undefined && qty === i.originalQuantity.trim() && i.amountValue != null && i.amountUnit != null
          return {
            name: i.name.trim(),
            quantity: qty,
            displayText: i.displayText.trim() || undefined,
            alternativeGroup: i.alternativeGroup.trim() || undefined,
            amountValue: keepStructured ? i.amountValue! : undefined,
            amountUnit: keepStructured ? i.amountUnit! : undefined,
          }
        }),
      steps: v.steps.map((s) => s.trim()).filter(Boolean),
      dishType: v.dishType || undefined,
      cuisine: v.cuisine || undefined,
      usesAirFryer: v.airFryer === '' ? undefined : v.airFryer === 'yes',
    },
  }
}

const SOURCES: Source[] = ['ai', 'web', 'manual']
const selectStyle: CSSProperties = { ...inputStyle, cursor: 'pointer' }

export function RecipeForm({
  values,
  onChange,
  submitLabel,
  saving,
  error,
  onSubmit,
  onCancel,
  photoSection,
}: {
  values: RecipeFormValues
  onChange: (next: RecipeFormValues) => void
  submitLabel: string
  saving: boolean
  error: string | null
  onSubmit: () => void
  onCancel: () => void
  photoSection?: ReactNode
}) {
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  const hasTabBar = !pathname.startsWith('/recipe/')
  const { data: pantry } = usePantry()
  const { data: recipes } = useRecipes('all', '')
  const [tagDraft, setTagDraft] = useState('')

  const pantryNames = useMemo(
    () => (pantry ?? []).flatMap((group) => group.items.map((item) => item.name)),
    [pantry],
  )

  const existingOrigins = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>()
    for (const r of recipes ?? []) {
      const s = r.sourceName?.trim()
      if (!s) continue
      const k = s.toLocaleLowerCase('pl-PL')
      const prev = counts.get(k)
      counts.set(k, { label: prev?.label ?? s, count: (prev?.count ?? 0) + 1 })
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pl-PL')).map((x) => x.label)
  }, [recipes])

  const existingTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of recipes ?? []) {
      for (const t of r.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl-PL'))
      .map(([tag]) => tag)
  }, [recipes])

  const suggestedTags = useMemo(
    () => existingTags.filter((t) => !values.tags.includes(t)).slice(0, 10),
    [existingTags, values.tags],
  )

  const set = <K extends keyof RecipeFormValues>(key: K, val: RecipeFormValues[K]) =>
    onChange({ ...values, [key]: val })

  const setIng = (i: number, patch: Partial<RecipeFormIngredient>) =>
    set(
      'ings',
      values.ings.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    )

  function move<T>(arr: T[], from: number, delta: number): T[] {
    const to = from + delta
    if (to < 0 || to >= arr.length) return arr
    const next = [...arr]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    return next
  }

  function addTag(raw: string) {
    const clean = normalizeTag(raw)
    if (!clean) return
    if (values.tags.length >= 15 || values.tags.includes(clean)) {
      setTagDraft('')
      return
    }
    set('tags', [...values.tags, clean])
    setTagDraft('')
  }

  const cols = (desktop: string) => (isMobile ? '1fr' : desktop)
  const saveButtons = (
    <div style={{ display: 'flex', gap: 10 }}>
      <Button size={isMobile ? 'xl' : 'lg'} style={{ flex: isMobile ? 1.4 : undefined }} onClick={onSubmit} disabled={saving}>
        {saving ? 'Zapisywanie…' : submitLabel}
      </Button>
      <Button variant="quiet" size={isMobile ? 'xl' : 'lg'} style={{ flex: isMobile ? 1 : undefined }} onClick={onCancel}>
        Anuluj
      </Button>
    </div>
  )

  return (
    <>
      <Section title="Podstawy">
        <Field label="Tytuł">
          <input
            style={inputStyle}
            value={values.title}
            maxLength={300}
            onChange={(e) => set('title', e.target.value)}
            placeholder="np. Chrupiące gnocchi z frytkownicy"
          />
        </Field>
        <Field label="Skąd przepis">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SOURCES.map((s) => (
              <Chip key={s} active={values.source === s} onClick={() => set('source', s)}>
                {sourceLabel[s]}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Źródło (nazwa, opcjonalnie)" hint="Książka, strona albo jadłospis — pokazujemy je nad tytułem na kartach.">
          <datalist id="recipe-origin-names">
            {existingOrigins.map((name) => <option key={name} value={name} />)}
          </datalist>
          <input
            list="recipe-origin-names"
            style={inputStyle}
            value={values.sourceName}
            maxLength={80}
            onChange={(e) => set('sourceName', e.target.value)}
            placeholder="np. Daily Dieta, Jadłonomia"
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <Field label="Czas (min)">
            <input
              style={{ ...inputStyle, font: mono(15) }}
              type="number"
              min={0}
              max={1440}
              value={values.time}
              onChange={(e) => set('time', Number(e.target.value))}
            />
          </Field>
          <Field label="Porcje (bazowe)">
            <input
              style={{ ...inputStyle, font: mono(15) }}
              type="number"
              min={1}
              max={200}
              value={values.servings}
              onChange={(e) => set('servings', Number(e.target.value))}
            />
          </Field>
          <Field label="Trudność">
            <select style={selectStyle} value={values.difficulty} onChange={(e) => set('difficulty', e.target.value)}>
              {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: cols('repeat(3, minmax(0, 1fr))'), gap: 12 }}>
          <Field label="Rodzaj dania">
            <select style={selectStyle} value={values.dishType} onChange={(e) => set('dishType', e.target.value as DishType | '')}>
              <option value="">— brak —</option>
              {DISH_TYPES.map((d) => <option key={d} value={d}>{dishTypeLabel[d]}</option>)}
            </select>
          </Field>
          <Field label="Kuchnia">
            <select style={selectStyle} value={values.cuisine} onChange={(e) => set('cuisine', e.target.value as Cuisine | '')}>
              <option value="">— brak —</option>
              {CUISINES.map((c) => <option key={c} value={c}>{cuisineLabel[c]}</option>)}
            </select>
          </Field>
          <Field label="Frytkownica">
            <select style={selectStyle} value={values.airFryer} onChange={(e) => set('airFryer', e.target.value as '' | 'yes' | 'no')}>
              <option value="">Auto (wykryj z tekstu)</option>
              <option value="yes">Tak</option>
              <option value="no">Nie</option>
            </select>
          </Field>
        </div>
        <Field label="Opis">
          <textarea
            style={{ ...inputStyle, height: 'auto', minHeight: 72, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
            value={values.blurb}
            onChange={(e) => set('blurb', e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Wartości odżywcze i tagi">
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <Field label="Kcal (1 porcja)">
            <input
              style={{ ...inputStyle, font: mono(15) }}
              inputMode="numeric"
              value={values.kcal}
              onChange={(e) => set('kcal', e.target.value)}
              placeholder="np. 480"
            />
          </Field>
          <Field label="Białko (g)">
            <input
              style={{ ...inputStyle, font: mono(15) }}
              inputMode="decimal"
              value={values.protein}
              onChange={(e) => set('protein', e.target.value)}
              placeholder="np. 32"
            />
          </Field>
          <Field label="Tłuszcz (g)">
            <input
              style={{ ...inputStyle, font: mono(15) }}
              inputMode="decimal"
              value={values.fat}
              onChange={(e) => set('fat', e.target.value)}
              placeholder="np. 16"
            />
          </Field>
          <Field label="Węglowodany (g)">
            <input
              style={{ ...inputStyle, font: mono(15) }}
              inputMode="decimal"
              value={values.carbs}
              onChange={(e) => set('carbs', e.target.value)}
              placeholder="np. 45"
            />
          </Field>
        </div>
        <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>
          Wszystkie wartości podawaj na jedną porcję (1 osoba). Zostaw puste, jeśli jeszcze nie oszacowane.
        </span>

        <Field label="Tagi / kolekcje (opcjonalnie)" hint="Np. do pudełka, szybkie, na gości — zatwierdź Enterem lub przecinkiem (maks. 15).">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={tagDraft}
              maxLength={40}
              placeholder="np. do pudełka"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addTag(tagDraft)
                }
              }}
            />
            <Button variant="outline" size="md" onClick={() => addTag(tagDraft)} disabled={!normalizeTag(tagDraft) || values.tags.length >= 15}>
              + Dodaj
            </Button>
          </div>
          {values.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {values.tags.map((t) => (
                <Chip key={t} active onClick={() => set('tags', values.tags.filter((x) => x !== t))}>
                  #{t} ✕
                </Chip>
              ))}
            </div>
          )}
          {suggestedTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 2 }}>
              <span style={{ font: sans(12), color: 'var(--text-3)' }}>Istniejące:</span>
              {suggestedTags.map((t) => (
                <Chip key={t} onClick={() => addTag(t)}>
                  + #{t}
                </Chip>
              ))}
            </div>
          )}
        </Field>
      </Section>

      <Section title="Składniki">
        <datalist id="pantry-ingredient-names">
          {pantryNames.map((name) => <option key={name} value={name} />)}
        </datalist>
        {values.ings.map((ing, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'minmax(0,1fr) 96px 44px' : 'minmax(150px,.8fr) 110px minmax(200px,1.4fr) 100px auto',
              gap: 8,
              paddingBottom: isMobile ? 12 : 0,
              borderBottom: isMobile ? '1px solid var(--border)' : 0,
              alignItems: 'center',
            }}
          >
            <input
              list="pantry-ingredient-names"
              style={inputStyle}
              value={ing.name}
              placeholder="produkt w spiżarni"
              onChange={(e) => setIng(i, { name: e.target.value })}
            />
            <input
              style={inputStyle}
              value={ing.quantity}
              placeholder="ilość"
              onChange={(e) => setIng(i, { quantity: e.target.value })}
            />
            {isMobile && (
              <RemoveBtn onClick={() => set('ings', values.ings.length > 1 ? values.ings.filter((_, j) => j !== i) : values.ings)} />
            )}
            <input
              style={{ ...inputStyle, gridColumn: isMobile ? '1 / 3' : undefined }}
              value={ing.displayText}
              placeholder="pełny zapis, np. 2 kromki chleba na zakwasie"
              onChange={(e) => setIng(i, { displayText: e.target.value })}
            />
            <input
              style={inputStyle}
              value={ing.alternativeGroup}
              placeholder="grupa LUB"
              title="Ta sama wartość łączy zamienniki, np. spód"
              onChange={(e) => setIng(i, { alternativeGroup: e.target.value })}
            />
            {!isMobile && (
              <div style={{ display: 'flex', gap: 4 }}>
                <OrderBtn dir="up" disabled={i === 0} onClick={() => set('ings', move(values.ings, i, -1))} />
                <OrderBtn dir="down" disabled={i === values.ings.length - 1} onClick={() => set('ings', move(values.ings, i, 1))} />
                <RemoveBtn onClick={() => set('ings', values.ings.length > 1 ? values.ings.filter((_, j) => j !== i) : values.ings)} />
              </div>
            )}
          </div>
        ))}
        <AddBtn
          label="Dodaj składnik"
          onClick={() => set('ings', [...values.ings, { name: '', quantity: '', displayText: '', alternativeGroup: '' }])}
        />
      </Section>

      <Section title="Przygotowanie">
        {values.steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ flex: '0 0 22px', paddingTop: 10, fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 22, lineHeight: 1, color: 'var(--accent-text)' }}>
              {i + 1}
            </span>
            <textarea
              style={{ ...inputStyle, height: 'auto', flex: 1, minHeight: 46, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
              value={s}
              placeholder={`Krok ${i + 1}`}
              onChange={(e) => set('steps', values.steps.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 4 }}>
              {!isMobile && (
                <>
                  <OrderBtn dir="up" disabled={i === 0} onClick={() => set('steps', move(values.steps, i, -1))} />
                  <OrderBtn dir="down" disabled={i === values.steps.length - 1} onClick={() => set('steps', move(values.steps, i, 1))} />
                </>
              )}
              <RemoveBtn onClick={() => set('steps', values.steps.length > 1 ? values.steps.filter((_, j) => j !== i) : values.steps)} />
            </div>
          </div>
        ))}
        <AddBtn label="Dodaj krok" onClick={() => set('steps', [...values.steps, ''])} />
      </Section>

      <Section title="Na koniec">
        <Field label="Wskazówka (opcjonalnie)">
          <input style={inputStyle} value={values.tip} onChange={(e) => set('tip', e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {photoSection}
          <Field label="Kolor karty (bez zdjęcia)">
            <input
              type="color"
              value={values.tint}
              onChange={(e) => set('tint', e.target.value)}
              style={{ width: 56, height: 46, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', cursor: 'pointer', padding: 4 }}
            />
          </Field>
        </div>
      </Section>

      {error && (
        <div role="alert" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent-text)', font: sans(14, 500) }}>
          {error}
        </div>
      )}

      {isMobile ? (
        <div
          data-pinned-bar
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: hasTabBar ? `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))` : 0,
            zIndex: 20,
            padding: hasTabBar ? '10px 16px' : '10px 16px calc(10px + env(safe-area-inset-bottom))',
            background: 'var(--bg)',
            borderTop: '1px solid var(--border)',
          }}
        >
          {saveButtons}
        </div>
      ) : (
        saveButtons
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 22, paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>
        {title}
      </span>
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
    <button
      type="button"
      onClick={onClick}
      style={{
        alignSelf: 'flex-start',
        height: 40,
        padding: '0 14px',
        border: '1px dashed var(--border-2)',
        borderRadius: 999,
        background: 'transparent',
        color: 'var(--text-2)',
        cursor: 'pointer',
        font: sans(13.5, 600),
      }}
    >
      + {label}
    </button>
  )
}

function OrderBtn({ dir, disabled, onClick }: { dir: 'up' | 'down'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={dir === 'up' ? 'Przesuń wyżej' : 'Przesuń niżej'}
      style={{
        width: 34,
        height: 46,
        flex: '0 0 34px',
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'transparent',
        color: disabled ? 'var(--border-2)' : 'var(--text-3)',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 13,
      }}
    >
      {dir === 'up' ? '↑' : '↓'}
    </button>
  )
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Usuń"
      style={{
        width: 44,
        height: 46,
        flex: '0 0 44px',
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'transparent',
        color: 'var(--text-3)',
        cursor: 'pointer',
        fontSize: 14,
      }}
    >
      ✕
    </button>
  )
}
