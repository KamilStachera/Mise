import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

// Isolated API fixtures: never write test recipes into a real cookbook.
const recipes = Array.from({ length: 300 }, (_, index) => ({
  id: String(index), title: `Przepis ${String(index).padStart(3, '0')}`,
  source: index % 2 ? 'web' : 'manual', time: index + 1, servings: 2,
  difficulty: 'Łatwe', tint: '#c0552d', blurb: '', imageUrl: `/api/images/${index}.png`,
  toBuyCount: index % 3, dishType: 'main', cuisine: 'polish', usesAirFryer: false,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), kcal: null,
}))
const base = 'http://127.0.0.1:5184'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5184', '--strictPort'], {
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
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } })
    const errors = []
    const images = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route(`${base}/api/**`, async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.startsWith('/api/images/')) {
        images.push(path)
        return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#c0552d"/></svg>' })
      }
      return route.fulfill({ json: path === '/api/recipes' ? recipes : path === '/api/auth/me' ? { authenticated: false } : [] })
    })
    await page.goto(base)
    const cards = page.locator('main h3')
    await page.waitForFunction(() => document.querySelectorAll('main h3').length === 24).catch(async (error) => {
      console.error({ errors, text: (await page.locator('body').innerText()).slice(0, 2000), cards: await cards.count() })
      throw error
    })
    assert.equal(await cards.first().textContent(), 'Przepis 299')
    // Batch thumbnails (+ the four "Ostatnio dodane" rows on desktop) use the card
    // variant; only the browse hero loads one original photo.
    assert.ok(images.length > 0 && images.length <= 29)
    assert.ok(images.filter((url) => !url.endsWith('/card-v1.webp')).length <= 1)
    await page.locator('main').evaluate((main) => { main.scrollTop = main.scrollHeight })
    await page.waitForFunction(() => document.querySelectorAll('main h3').length === 48)

    // Search must find recipes that have never been mounted, and reset the batch.
    await page.getByPlaceholder('Szukaj po nazwie lub źródle').fill('Przepis 000')
    await page.waitForFunction(() => document.querySelectorAll('main h3').length === 1)
    assert.equal(await cards.first().textContent(), 'Przepis 000')
    await page.getByPlaceholder('Szukaj po nazwie lub źródle').fill('')
    await page.waitForFunction(() => document.querySelectorAll('main h3').length === 24)
    // Desktop: sort dropdown; phone: the sort chip opens the filter sheet.
    await page.getByRole('button', { name: 'Najnowsze', exact: true }).click()
    await page.getByRole('button', { name: 'Najszybsze', exact: true }).click()
    if (mobile) await page.keyboard.press('Escape')
    assert.equal(await cards.first().textContent(), 'Przepis 000')
    assert.equal(await cards.count(), 24)
    // Global source count/filter remains accurate despite progressive rendering.
    await page.getByRole('button', { name: mobile ? 'Moje' : /Moje własne/, exact: mobile }).click()
    assert.ok((await cards.allTextContents()).every((title) => Number(title.slice(-3)) % 2 === 0))
    for (let attempt = 0; await cards.count() < 150; attempt++) {
      assert.ok(attempt < 20, 'Scroll should reach every matching recipe')
      const before = await cards.count()
      await page.locator('main').evaluate((main) => { main.scrollTop = main.scrollHeight })
      await page.waitForFunction((count) => document.querySelectorAll('main h3').length > count, before)
    }
    assert.equal(await cards.count(), 150)
    assert.equal(new Set(await cards.allTextContents()).size, 150)
    assert.equal(await page.getByRole('button', { name: 'Pokaż więcej' }).count(), 0)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`${mobile ? 'Mobile' : 'Desktop'}: initial batch, thumbnails, scrolling, search, sorting, filters and end of list passed`)
  }

  const fallback = await browser.newPage()
  await fallback.addInitScript(() => { window.IntersectionObserver = undefined })
  await fallback.route(`${base}/api/**`, (route) => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/recipes'
    ? recipes.map((r) => ({ ...r, imageUrl: null })) : { authenticated: false } }))
  await fallback.goto(base)
  await fallback.waitForFunction(() => document.querySelectorAll('main h3').length === 24)
  await fallback.getByRole('button', { name: 'Pokaż więcej' }).click()
  assert.equal(await fallback.locator('main h3').count(), 48)
  await fallback.close()
  console.log('Manual load-more fallback passed without IntersectionObserver')
} finally {
  await browser?.close()
  server.kill()
}
