// Sous runner: one Codex turn per HTTP request, signed in with the household's ChatGPT
// plan (CODEX_HOME holds auth.json + thread sessions). Internal only — the api container
// is the sole caller and authenticates via X-Sous-Secret; never publish this port.
//
//   POST /turn  { prompt, instructions, threadId?, person, household, token } → NDJSON stream of
//               { status } | { delta } | { threadId } | { error } … then { done: true }
//   POST /job   { prompt, outputSchema } → { text } (JSON matching the schema) | { error, limit }
//               A one-off background task (exercise descriptions): fresh thread, live web
//               search, no MCP tools — the api validates and saves the result itself.
//   GET  /health → { ok, loggedIn }
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { Codex } from '@openai/codex-sdk'

const PORT = Number(process.env.PORT ?? 8090)
const MCP_ENTRY = process.env.MCP_ENTRY ?? '/app/mcp/dist/index.js'
const CODEX_HOME = process.env.CODEX_HOME ?? join(process.env.HOME ?? '/data', '.codex')
const MAX_BODY_BYTES = 256 * 1024
const MAX_CONCURRENT = Number(process.env.SOUS_MAX_CONCURRENT ?? 3)
const SOUS_SECRET = process.env.SOUS_SECRET?.trim()
  || (process.env.MISE_API_KEY?.trim()
    ? createHash('sha256').update('pichci-sous-internal:' + process.env.MISE_API_KEY.trim()).digest('hex')
    : '')

function authorized(req) {
  if (!SOUS_SECRET) return true
  const got = String(req.headers['x-sous-secret'] ?? '')
  const a = Buffer.from(got, 'utf8')
  const b = Buffer.from(SOUS_SECRET, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

// No /context mount: Sous reads and writes strictly through its per-turn household-scoped MCP tools.
const threadOptions = {
  workingDirectory: '/tmp',
  skipGitRepoCheck: true,
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  networkAccessEnabled: false,
  webSearchMode: process.env.SOUS_WEB_SEARCH || 'cached',
  modelReasoningEffort: process.env.SOUS_REASONING || 'low',
  ...(process.env.SOUS_MODEL ? { model: process.env.SOUS_MODEL } : {}),
}

/** One Codex per turn: the short-lived token pins the MCP server to one (household, person). */
function codexFor(person, token) {
  return new Codex({
    config: {
      mcp_servers: {
        pichci: {
          command: 'node',
          args: [MCP_ENTRY],
          // Nobody is there to click "allow": with approval policy never, any tool that
          // still wants approval is refused. The chat prompt asks before destructive changes.
          default_tools_approval_mode: 'approve',
          env: {
            MISE_API_URL: process.env.MISE_API_URL ?? 'http://api:8080',
            MISE_API_KEY: token,
            MISE_PERSON: String(person),
            MISE_ALLOWED_IMAGE_DIR: join(CODEX_HOME, 'generated_images'),
          },
        },
      },
    },
  })
}

// Polish status line for the "Sous pracuje…" bubble, by what Codex is doing.
const TOOL_STATUS = [
  [/recipe_page/, 'Czytam stronę z przepisem…'],
  [/import_document/, 'Czytam PDF…'],
  [/pantry|receipt/, 'Sprawdzam spiżarnię…'],
  [/shopping/, 'Zaglądam na listę zakupów…'],
  [/suppl/, 'Zaglądam na listę domową…'],
  [/recipe|cookbook/, 'Przeglądam przepisy…'],
  [/plan|food|fridge|favorite/, 'Zaglądam do dziennika…'],
  [/budget|progress|goal|weight/, 'Liczę budżet…'],
  [/activity|workout/, 'Sprawdzam aktywność…'],
  [/cook/, 'Zaglądam do historii gotowania…'],
]

function statusOf(item) {
  switch (item.type) {
    case 'mcp_tool_call':
      return TOOL_STATUS.find(([re]) => re.test(item.tool))?.[1] ?? 'Korzystam z Pichci…'
    case 'command_execution':
      return 'Czytam książkę kucharską…'
    case 'web_search':
      return 'Szukam w sieci…'
    case 'reasoning':
      return 'Zastanawiam się…'
    default:
      return null
  }
}

async function runTurn({ prompt, instructions, threadId, person, household, token }, send, signal) {
  if (!Number.isInteger(person) || person <= 0) throw new Error('person is required')
  if (!Number.isInteger(household) || household <= 0) throw new Error('household is required')
  if (typeof token !== 'string' || !token) throw new Error('token is required')
  const codex = codexFor(person, token)
  const options = threadOptions
  let thread = threadId ? codex.resumeThread(threadId, options) : codex.startThread(options)
  let input = threadId ? prompt : `${instructions}\n\n${prompt}`
  let started = false

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { events } = await thread.runStreamed(input, { signal })
      // Agent messages before the last one are progress notes („Sprawdzę spiżarnię”); only
      // the final one is the answer, so hold each until the next one or the turn's end.
      let pending = null
      for await (const ev of events) {
        started = true
        if (ev.type === 'thread.started') send({ threadId: ev.thread_id })
        else if (ev.type === 'item.started' || (ev.type === 'item.completed' && ev.item.type !== 'agent_message')) {
          const s = statusOf(ev.item)
          if (s) send({ status: s })
          if (ev.item.type === 'mcp_tool_call' && ev.item.status === 'failed')
            console.warn(`tool ${ev.item.tool} failed: ${ev.item.error?.message}`)
        } else if (ev.type === 'item.completed' && ev.item.type === 'agent_message') {
          if (pending) send({ status: firstLine(pending) })
          pending = ev.item.text
        } else if (ev.type === 'turn.failed') throw new Error(ev.error.message)
        else if (ev.type === 'error') throw new Error(ev.message)
      }
      if (pending) send({ delta: pending })
      return
    } catch (e) {
      // A thread lost with the volume (or never saved) can't resume: start over once.
      if (threadId && !started && attempt === 0 && !signal.aborted) {
        console.warn(`resume ${threadId} failed (${e.message}); starting a new thread`)
        thread = codex.startThread(options)
        input = `${instructions}\n\n${prompt}`
        continue
      }
      throw e
    }
  }
}

const firstLine = (s) => s.split('\n').find((l) => l.trim())?.trim().slice(0, 120) ?? ''

function friendly(message) {
  if (/401|unauthori[sz]ed|log ?in|auth/i.test(message))
    return 'Sous nie jest zalogowany do ChatGPT. Na serwerze: docker compose exec sous codex login --device-auth'
  if (isLimit(message))
    return 'Limit Codexa w planie ChatGPT na teraz się wyczerpał — spróbuj za jakiś czas.'
  return `Sous nie odpowiedział: ${message}`
}

const loggedIn = () => existsSync(join(CODEX_HOME, 'auth.json'))

// Background jobs write nothing and read nothing locally: no MCP, empty working dir.
const jobOptions = {
  workingDirectory: '/tmp',
  skipGitRepoCheck: true,
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  networkAccessEnabled: false,
  webSearchMode: process.env.SOUS_JOB_WEB_SEARCH || 'live',
  modelReasoningEffort: process.env.SOUS_JOB_REASONING || 'low',
  ...(process.env.SOUS_MODEL ? { model: process.env.SOUS_MODEL } : {}),
}
const jobCodex = new Codex()

async function runJob({ prompt, outputSchema }, signal) {
  const thread = jobCodex.startThread(jobOptions)
  const result = await thread.run(prompt, { outputSchema, signal })
  return { text: result.finalResponse, usage: result.usage }
}

const isLimit = (message) => /usage limit|rate limit|429/i.test(message)

async function readJson(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buf)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

let inFlight = 0

async function handleJob(req, res) {
  if (!authorized(req)) {
    res.writeHead(401).end()
    return
  }
  if (inFlight >= MAX_CONCURRENT) {
    res.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'busy' }))
    return
  }
  let body
  try {
    body = await readJson(req)
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new Error('prompt')
  } catch {
    res.writeHead(400).end()
    return
  }
  const abort = new AbortController()
  res.on('close', () => { if (!res.writableFinished) abort.abort() })
  const t0 = Date.now()
  inFlight++
  try {
    if (!loggedIn()) throw new Error('not logged in')
    const out = await runJob(body, abort.signal)
    if (!res.destroyed) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(out))
    }
    console.log(`job ok ${Date.now() - t0} ms`)
  } catch (e) {
    console.error(`job failed after ${Date.now() - t0} ms: ${e.message}`)
    if (!abort.signal.aborted && !res.destroyed) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message, limit: isLimit(e.message) }))
    }
  } finally {
    inFlight--
  }
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, loggedIn: loggedIn() }))
    return
  }
  if (req.method === 'POST' && req.url === '/job') {
    await handleJob(req, res)
    return
  }
  if (req.method !== 'POST' || req.url !== '/turn') {
    res.writeHead(404).end()
    return
  }
  if (!authorized(req)) {
    res.writeHead(401).end()
    return
  }
  if (inFlight >= MAX_CONCURRENT) {
    res.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'busy' }))
    return
  }

  let body
  try {
    body = await readJson(req)
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new Error('prompt')
    if (!Number.isInteger(body.person) || body.person <= 0) throw new Error('person')
    if (!Number.isInteger(body.household) || body.household <= 0) throw new Error('household')
    if (typeof body.token !== 'string' || !body.token) throw new Error('token')
  } catch {
    res.writeHead(400).end()
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' })
  const send = (obj) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(obj) + '\n') }
  const abort = new AbortController()
  res.on('close', () => { if (!res.writableFinished) abort.abort() })

  const t0 = Date.now()
  inFlight++
  try {
    if (!loggedIn()) throw new Error('not logged in')
    await runTurn(body, send, abort.signal)
  } catch (e) {
    if (!abort.signal.aborted) {
      console.error(`turn failed: ${e.message}`)
      send({ error: friendly(e.message) })
    }
  } finally {
    inFlight--
  }
  console.log(`turn household=${body.household} person=${body.person} ${body.threadId ? 'resume' : 'new'} ${Date.now() - t0} ms`)
  send({ done: true })
  if (!res.destroyed && !res.writableEnded) res.end()
}).listen(PORT, () => console.log(`sous listening on :${PORT}, logged in: ${loggedIn()}`))
