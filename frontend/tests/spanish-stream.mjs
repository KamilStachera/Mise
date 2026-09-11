import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = 'http://127.0.0.1:5185'
const classSource = await readFile(new URL('./fixtures/class-words.tsv', import.meta.url), 'utf8')
const expectedClass = new Map(classSource.trim().split(/\r?\n/).slice(1).map((line) => line.split('\t')))
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5185', '--strictPort'], {
  stdio: 'ignore', windowsHide: true,
})
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base)).ok) break } catch { /* starting */ }
    if (attempt === 100) throw new Error('Vite did not start')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  await mkdir('../tmp/spanish-stream', { recursive: true })
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 1000 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route(`${base}/api/**`, (route) => route.fulfill({ json:
      new URL(route.request().url()).pathname === '/api/auth/me' ? { authenticated: true } : [] }))
    await page.addInitScript(() => {
      sessionStorage.setItem('pichci.pendingCookSeen', '1')
      if (!localStorage.getItem('palabras.v1')) localStorage.setItem('palabras.v1', JSON.stringify({
        srs: { w1: { ease: 2.4, interval: 4, reps: 2, lapses: 0, due: 123456 } }, custom: [],
      }))
    })
    await page.goto(`${base}/palabras`)
    await page.getByRole('button', { name: 'Dźwięki', exact: true }).click()
    await page.getByRole('button', { name: 'Strumień słów', exact: true }).click()
    const current = page.locator('.word-stream__word[aria-current="true"]')
    assert.equal(await current.count(), 1)
    const before = await page.evaluate(() => localStorage.getItem('palabras.v1'))
    const original = await current.textContent()
    assert.equal(await page.locator('.word-stream__hint').count(), 0)
    await page.getByRole('button', { name: 'Pokaż podpowiedź', exact: true }).click()
    assert.equal(await page.locator('.word-stream__hint').count(), 2)
    await page.getByRole('checkbox', { name: 'Wymowa po polsku', exact: true }).uncheck()
    assert.equal(await page.locator('.word-stream__hint').count(), 1)
    assert.equal(await page.locator('.word-stream__rule').count(), 0)
    assert.equal(await page.locator('.word-stream__hint .section-label').textContent(), 'Tłumaczenie')
    await page.getByRole('checkbox', { name: 'Wymowa po polsku', exact: true }).check()
    await page.getByRole('checkbox', { name: 'Tłumaczenie', exact: true }).uncheck()
    assert.equal(await page.locator('.word-stream__hint .section-label').textContent(), 'Czytaj jak Polak')
    await page.getByRole('button', { name: 'Następne →', exact: true }).click()
    assert.notEqual(await current.textContent(), original)
    assert.equal(await page.locator('.word-stream__hint').count(), 0)
    await page.getByRole('button', { name: '← Wstecz', exact: true }).click()
    assert.equal(await current.textContent(), original)
    // Clicking an entry selects it and updates the answer panel.
    const selected = await page.locator('.word-stream__word').nth(5).textContent()
    await page.locator('.word-stream__word').nth(5).click()
    assert.equal(await current.textContent(), selected)
    assert.equal(await page.locator('.word-stream__current strong').textContent(), selected)
    await page.getByRole('button', { name: 'Pokaż podpowiedź', exact: true }).click()
    for (let i = 0; i < 40; i++) await page.getByRole('button', { name: 'Następne →', exact: true }).click()
    assert.equal(await page.locator('.word-stream__word').count(), 32)
    assert.equal(await current.count(), 1)
    assert.equal(await page.locator('.word-stream__hint').count(), 0)
    assert.ok(await current.evaluate((word) => {
      const rect = word.getBoundingClientRect(), panel = word.parentElement.getBoundingClientRect()
      return rect.top >= panel.top && rect.bottom <= panel.bottom
    }))
    await page.getByRole('checkbox', { name: 'Wymowa po polsku', exact: true }).uncheck()
    assert.ok(await page.getByRole('button', { name: 'Pokaż podpowiedź', exact: true }).isDisabled())
    await page.getByRole('checkbox', { name: 'Wymowa po polsku', exact: true }).check()
    await page.getByRole('button', { name: 'Pokaż podpowiedź', exact: true }).click()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    if (mobile) {
      const nextBox = await page.getByRole('button', { name: 'Następne →', exact: true }).boundingBox()
      assert.ok(nextBox.y + nextBox.height <= 844 - 64, 'Next stays above the fixed mobile navigation')
    }
    await page.screenshot({ path: `../tmp/spanish-stream/${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => localStorage.getItem('palabras.v1')), before)
    await page.reload()
    await page.getByRole('button', { name: 'Dźwięki', exact: true }).click()
    assert.ok(await page.locator('.sound').count() > 0)
    await page.getByRole('button', { name: 'Strumień słów', exact: true }).click()
    assert.ok(await page.getByRole('checkbox', { name: 'Wymowa po polsku', exact: true }).isChecked())
    assert.equal(await page.getByRole('checkbox', { name: 'Tłumaczenie', exact: true }).isChecked(), false)

    // Exercise multiple complete cycles with a reproducible random source.
    const checks = await page.evaluate(async () => {
      const { buildStreamPool, createStream, selectStreamWord } = await import('/src/palabras/lib/wordStream.ts')
      const { SOUNDS } = await import('/src/palabras/data/sounds.ts')
      const { WORDS } = await import('/src/palabras/data/words.ts')
      const pool = buildStreamPool(SOUNDS, WORDS)
      const expanded = SOUNDS.flatMap((group) => group.words).filter((word) => /[A-ZŁŃ]/.test(word.resp))
      const missingExpanded = expanded.filter((word) => !pool.some((entry) => entry.es === word.es
        && entry.resp === word.resp && entry.pl === word.pl && entry.rules.length > 0))
      let seed = 1234
      const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296 }
      let state = createStream(pool, random)
      const read = [], sizes = []
      for (let i = 0; i < pool.length * 6; i++) {
        read.push(state.words[state.index].es)
        sizes.push(state.words.length)
        state = selectStreamWord(state, state.index + 1, pool, random)
      }
      const empty = createStream([], random)
      let single = createStream([pool[0]], random)
      for (let i = 0; i < 100; i++) single = selectStreamWord(single, single.index + 1, [pool[0]], random)
      const duplicate = buildStreamPool([{ g: 'A', rule: 'one', words: [{ es: 'hola', pl: 'cześć', resp: 'ola' }] },
        { g: 'B', rule: 'two', words: [{ es: 'hola', pl: 'cześć', resp: 'ola' }] }], [])
      return { size: pool.length, read, sizes, expanded: expanded.length, missingExpanded,
        classWords: WORDS.filter((word) => word.deck === 'zajecia'), ids: WORDS.map((word) => word.id),
        soundGroups: SOUNDS.length, empty: empty.words.length, single: single.words.length,
        rules: duplicate[0].rules.length, duplicateCount: duplicate.length }
    })
    for (let i = 0; i < checks.read.length; i += checks.size)
      assert.equal(new Set(checks.read.slice(i, i + checks.size)).size, checks.size)
    assert.ok(checks.read.every((word, i) => i === 0 || word !== checks.read[i - 1]))
    assert.ok(checks.sizes.every((size) => size === 32))
    assert.equal(checks.empty, 0)
    assert.equal(checks.single, 32)
    assert.equal(checks.rules, 2)
    assert.equal(checks.duplicateCount, 1)
    assert.ok(checks.size >= 201, 'The stream includes the expanded pronunciation vocabulary')
    assert.ok(checks.expanded >= 80, 'New words include marked stress')
    assert.ok(checks.soundGroups >= 20, 'Includes gü, initial r, diphthongs and hiatus groups')
    assert.deepEqual(checks.missingExpanded, [])
    assert.equal(checks.classWords.length, expectedClass.size)
    assert.equal(new Set(checks.ids).size, checks.ids.length)
    assert.equal(checks.classWords.filter((word) => word.es === 'correr').length, 1)
    for (const word of checks.classWords) {
      assert.ok(expectedClass.has(word.es))
      assert.ok(word.resp && word.trap)
      assert.ok(word.id.startsWith('zajecia-'))
      assert.equal(word.pl, word.es === 'pague' ? 'niech pan/pani zapłaci' : expectedClass.get(word.es))
    }
    assert.ok(checks.classWords.find((word) => word.es === 'pague').trap.includes('pagué'))

    // Select the lesson deck and verify it drives both flashcard practice and reading.
    await page.getByRole('button', { name: 'Talia', exact: true }).click()
    const classDeck = page.locator('.deck').filter({ hasText: 'Z zajęć' })
    assert.ok((await classDeck.textContent()).includes('79 słów'))
    await classDeck.click()
    await page.getByRole('button', { name: /Zacznij sesję/ }).click()
    assert.equal(await page.locator('.card__deck').textContent(), 'Z zajęć')
    const lessonTerm = await page.locator('.card__es').textContent()
    assert.ok(expectedClass.has(lessonTerm))
    await page.getByRole('button', { name: 'Pokaż tłumaczenie', exact: true }).click()
    assert.equal(await page.locator('.answer__pl').textContent(), checks.classWords.find((word) => word.es === lessonTerm).pl)
    await page.getByRole('button', { name: /^Dobrze/ }).click()
    const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('palabras.v1')).srs)
    assert.deepEqual(progress.w1, JSON.parse(before).srs.w1)
    assert.ok(progress[checks.classWords.find((word) => word.es === lessonTerm).id])

    await page.getByRole('button', { name: 'Dźwięki', exact: true }).click()
    await page.getByRole('button', { name: 'Strumień słów', exact: true }).click()
    const setSelector = page.getByLabel('Zestaw słów', { exact: true })
    assert.equal(await setSelector.inputValue(), 'zajecia')
    assert.ok((await page.locator('.word-stream > .page-sub').textContent()).includes('79'))
    assert.ok((await page.locator('.word-stream__word').allTextContents()).every((word) => expectedClass.has(word)))
    await page.getByRole('button', { name: 'Pokaż podpowiedź', exact: true }).click()
    await setSelector.selectOption('all')
    assert.equal(await page.locator('.word-stream__hint').count(), 0)
    assert.equal(await page.locator('.word-stream__current > span').textContent(), 'Słowo 1')
    await setSelector.selectOption('moje')
    assert.equal(await page.locator('.word-stream__word').count(), 0)
    assert.ok(await page.getByText('Dodaj słowa, żeby rozpocząć czytanie.', { exact: true }).isVisible())
    await setSelector.selectOption('zajecia')
    await page.screenshot({ path: `../tmp/spanish-stream/classes-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true })
    assert.deepEqual(errors, [])
    console.log(`${mobile ? 'Mobile' : 'Desktop'} passed: manual controls, hints, preferences, unchanged SRS, ${checks.size} unique entries, six shuffled cycles and bounded rendering`)
    await page.close()
  }
} finally {
  await browser?.close()
  server.kill()
}
