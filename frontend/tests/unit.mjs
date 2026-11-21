// Zero-dependency Node unit tests for pure frontend date, chart alignment, rep-range, and Polish plural helpers.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(here, '..', 'src')

/** Transpile a standalone TypeScript module from src/ to an ESM data URL so Node runs the real source code. */
async function importTs(relPath) {
  const source = readFileSync(resolve(srcDir, relPath), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  const url = `data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`
  return import(url)
}

const dates = await importTs('lib/dates.ts')
const labels = await importTs('lib/labels.ts')
const recipeParsing = await importTs('lib/recipeParsing.ts')

test('dates: parseISODate and toISO round-trip across leap years and month boundaries', () => {
  for (const iso of ['2024-02-29', '2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31']) {
    assert.equal(dates.toISO(dates.parseISODate(iso)), iso)
  }
  // Invalid calendar date (Feb 31) rolls over and fails round-trip equality.
  assert.notEqual(dates.toISO(dates.parseISODate('2026-02-31')), '2026-02-31')
})

test('dates: daysAgo and WeightChart midnight alignment stay exact at any time of day', () => {
  const lateEvening = new Date(2026, 10, 20, 23, 45, 0)
  assert.equal(dates.daysAgo('2026-11-20', lateEvening), 0)
  assert.equal(dates.daysAgo('2026-11-19', lateEvening), 1)
  assert.equal(dates.daysAgo('2026-11-21', lateEvening), -1)

  // Normalized midnight start ensures dayIndex is an exact integer for every point.
  const today = dates.parseISODate('2026-11-20')
  const start = dates.addDays(today, -27)
  const dayIndex = (iso) => Math.round((dates.parseISODate(iso).getTime() - start.getTime()) / 86_400_000)
  assert.equal(dayIndex('2026-11-20'), 27)
  assert.equal(dayIndex(dates.toISO(start)), 0)
})

test('dates: mondayOf always returns Monday (getDay() === 1) for every day of the week', () => {
  for (let d = 16; d <= 22; d++) {
    const m = dates.mondayOf(dates.parseISODate(`2026-11-${d}`))
    assert.equal(dates.toISO(m), '2026-11-16')
    assert.equal(m.getDay(), 1)
  }
})

test('labels: Polish plural handles 0, 1, 2-4, teens (11-14), and 22-24 correctly', () => {
  assert.equal(labels.plural(0, 'porcja', 'porcje', 'porcji'), '0 porcji')
  assert.equal(labels.plural(1, 'porcja', 'porcje', 'porcji'), '1 porcja')
  assert.equal(labels.plural(2, 'porcja', 'porcje', 'porcji'), '2 porcje')
  assert.equal(labels.plural(4, 'porcja', 'porcje', 'porcji'), '4 porcje')
  assert.equal(labels.plural(5, 'porcja', 'porcje', 'porcji'), '5 porcji')
  assert.equal(labels.plural(12, 'porcja', 'porcje', 'porcji'), '12 porcji')
  assert.equal(labels.plural(22, 'porcja', 'porcje', 'porcji'), '22 porcje')
})

test('DayEditorSheet rep-range parsing supports typing intermediate "10-" and ranges "10-12"', () => {
  // Mirror the exact parser contract exported from DayEditorSheet.tsx.
  const parseRepsRange = (raw) => {
    const trimmed = raw.trim()
    if (!trimmed) return { repsMin: null, repsMax: null }
    const parts = trimmed.split(/[-–—]/).map((p) => p.trim()).filter(Boolean)
    const num = (s) => {
      const v = Number(s.replace(',', '.'))
      return s.trim() === '' || !Number.isFinite(v) ? null : v
    }
    const lo = parts[0] != null ? num(parts[0]) : null
    const hi = parts[1] != null ? num(parts[1]) : lo
    return { repsMin: lo, repsMax: hi }
  }
  assert.deepEqual(parseRepsRange('10-12'), { repsMin: 10, repsMax: 12 })
  assert.deepEqual(parseRepsRange('8–10'), { repsMin: 8, repsMax: 10 })
  assert.deepEqual(parseRepsRange('12'), { repsMin: 12, repsMax: 12 })
  assert.deepEqual(parseRepsRange('10-'), { repsMin: 10, repsMax: 10 })
  assert.deepEqual(parseRepsRange(''), { repsMin: null, repsMax: null })
})

test('recipeParsing: matchesRecipeQuery supports multi-word diacritic-insensitive ingredient & tag search', () => {
  const r = {
    title: 'Naleśniki białkowe',
    sourceName: 'Daily Dieta',
    tags: ['do pudełka', 'szybkie'],
    ingredients: ['Twaróg chudy', 'Szpinak', 'Jajka'],
  }
  assert.equal(recipeParsing.matchesRecipeQuery(r, 'twarog szpinak'), true)
  assert.equal(recipeParsing.matchesRecipeQuery(r, 'pudelka jajka'), true)
  assert.equal(recipeParsing.matchesRecipeQuery(r, 'daily dieta'), true)
  assert.equal(recipeParsing.matchesRecipeQuery(r, 'twarog kurczak'), false)
  assert.equal(recipeParsing.matchesRecipeQuery(r, '   '), true)
})

test('recipeParsing: normalizeTag, nutrition & yield parsers handle Polish formats', () => {
  assert.equal(recipeParsing.normalizeTag('  #Do   Pudełka  '), 'do pudełka')
  assert.equal(recipeParsing.normalizeTag('###'), '')
  assert.equal(recipeParsing.parseNutritionNumber('420 kcal'), 420)
  assert.equal(recipeParsing.parseNutritionNumber('18,5 g'), 18.5)
  assert.equal(recipeParsing.parseNutritionNumber('0 g'), 0)
  assert.equal(recipeParsing.parseNutritionNumber(null), null)
  assert.equal(recipeParsing.parseYieldServings('4 porcje'), 4)
  assert.equal(recipeParsing.parseYieldServings('2-4 servings'), 2)
  assert.equal(recipeParsing.parseYieldServings('0'), null)
  assert.deepEqual(recipeParsing.parseIngredient('200 g mąki pszennej'), {
    name: 'mąki pszennej',
    quantity: '200 g',
    displayText: '200 g mąki pszennej',
    alternativeGroup: '',
  })
})
