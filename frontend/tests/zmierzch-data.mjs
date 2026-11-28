// Validates the Twilight quiz bank (src/zmierzch/questions/*.json): shape, enums, unique ids,
// sane ABCD options and near-duplicate questions. Run: npm run test:zmierzch
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../src/zmierzch/questions/', import.meta.url))
const PARTS = ['zmierzch', 'ksiezyc', 'zacmienie', 'przed-switem', 'saga']
const SOURCES = ['film', 'ksiazka', 'oba']
const CATEGORIES = ['fabula', 'postacie', 'cytaty', 'muzyka', 'obsada', 'kulisy', 'roznice', 'miejsca', 'liczby']

const errors = []
const ids = new Map()
const questions = new Map()
const texts = new Map()
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0

let total = 0
const perPart = Object.fromEntries(PARTS.map((p) => [p, 0]))

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  let list
  try {
    list = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  } catch (e) {
    errors.push(`${file}: invalid JSON — ${e.message}`)
    continue
  }
  if (!Array.isArray(list)) {
    errors.push(`${file}: top level must be an array`)
    continue
  }
  for (const q of list) {
    const at = `${file} ${q?.id ?? '(no id)'}`
    total++
    if (!nonEmpty(q.id)) errors.push(`${at}: missing id`)
    else if (ids.has(q.id)) errors.push(`${at}: duplicate id (also in ${ids.get(q.id)})`)
    else {
      ids.set(q.id, file)
      questions.set(q.id, q)
    }
    if (!PARTS.includes(q.part)) errors.push(`${at}: bad part "${q.part}"`)
    else perPart[q.part]++
    if (!SOURCES.includes(q.source)) errors.push(`${at}: bad source "${q.source}"`)
    if (!CATEGORIES.includes(q.category)) errors.push(`${at}: bad category "${q.category}"`)
    if (![1, 2, 3].includes(q.difficulty)) errors.push(`${at}: difficulty must be 1, 2 or 3`)
    if (!nonEmpty(q.q)) errors.push(`${at}: empty question`)
    if (!nonEmpty(q.answer)) errors.push(`${at}: empty answer`)
    if (q.note !== undefined && !nonEmpty(q.note)) errors.push(`${at}: note present but empty`)
    if (!Array.isArray(q.wrong) || q.wrong.length !== 3 || !q.wrong.every(nonEmpty)) {
      errors.push(`${at}: wrong must be 3 non-empty strings`)
    } else {
      const opts = [q.answer, ...q.wrong].map(norm)
      if (new Set(opts).size !== 4) errors.push(`${at}: answer and wrong options must all differ`)
    }
    if (nonEmpty(q.q)) {
      const key = norm(q.q)
      if (texts.has(key)) errors.push(`${at}: same question text as ${texts.get(key)}`)
      else texts.set(key, q.id)
    }
  }
}

// Editorial regressions found in the 2026-11-16 review. These check facts and
// translation provenance, not general Polish fluency (which needs manual review).
// Evidence and scope: docs/zmierzch-review-2026-11-16.md.
const check = (id, predicate, message) => {
  const q = questions.get(id)
  if (!q || !predicate(q)) errors.push(`${id}: ${message}`)
}
check('ku-024', q => /białą królową/i.test(q.answer) && /czerwonego pionka/i.test(q.answer),
  'Breaking Dawn cover has a white queen and a red pawn, not the reverse')
check('ku-026', q => q.answer === '„Gwałtownych uciech i koniec gwałtowny”' && /Paszkowskiego/.test(q.note ?? ''),
  'use the published Polish epigraph and identify its translator')
check('kn-019', q => q.source === 'ksiazka',
  'Bella’s job at the Newton store is a book question, not a theatrical-film question')
check('ku-038', q => q.answer === '2005' && /amerykańskie/.test(q.q),
  'the 2005 publication date must explicitly refer to the US edition')
check('ps-036', q => /przed napisami/.test(q.q),
  'the final shot question must exclude the Volturi scene during the credits')

for (const id of ['zm-010', 'zm-011', 'zm-012', 'zm-024', 'za-008', 'sa-027']) {
  check(id, q => /pomocnicz|parafraz/.test(q.note ?? ''),
    'an unofficial Polish rendering must be labelled as a translation or paraphrase')
  check(id, q => !/\b(?:what|how long|say it|hold on|let['’]s|you['’]ve|a while)\b/i.test([q.q, q.answer, ...(Array.isArray(q.wrong) ? q.wrong : [])].join(' ')),
    'spoken English quotes belong in the explanation; prompts and choices use Polish')
}

// Validate fixed challenge sets in src/zmierzch/sets.ts: every referenced question id must exist
// and appear at most once per set. Movie-labelled sets must contain zero book-only or book-vs-film entries.
const setsSrc = readFileSync(fileURLToPath(new URL('../src/zmierzch/sets.ts', import.meta.url)), 'utf8')
const setBlocks = [...setsSrc.matchAll(/slug:\s*'([^']+)'[\s\S]*?scope:\s*'([^']+)'[\s\S]*?questionIds:\s*\[([\s\S]*?)\]/g)]
const MOVIE_ONLY_SETS = new Set(['rozgrzewka', 'egzamin-1', 'egzamin-2', 'egzamin-filmowy', 'proba-mova-filmy'])
if (setBlocks.length === 0) errors.push('sets.ts: no quiz sets found')
for (const [, slug, scope, body] of setBlocks) {
  if (scope !== `set:${slug}`) errors.push(`sets.ts (${slug}): scope "${scope}" must equal "set:${slug}"`)
  const setIds = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
  if (setIds.length === 0) errors.push(`sets.ts (${slug}): empty questionIds`)
  const seenInSet = new Set()
  for (const id of setIds) {
    const q = questions.get(id)
    if (!q) errors.push(`sets.ts (${slug}): unknown question id "${id}"`)
    else if (MOVIE_ONLY_SETS.has(slug) && (q.source === 'ksiazka' || (q.source === 'oba' && q.category === 'roznice'))) {
      errors.push(`sets.ts (${slug}): movie-only set contains book question "${id}" (${q.source}/${q.category})`)
    }
    if (seenInSet.has(id)) errors.push(`sets.ts (${slug}): duplicate question id "${id}"`)
    seenInSet.add(id)
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  console.error(`\n${errors.length} problem(s) in ${total} questions`)
  process.exit(1)
}
console.log(`OK — ${total} questions`, perPart)
