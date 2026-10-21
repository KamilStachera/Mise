// Sous runner: one Codex turn per HTTP request, signed in with the household's ChatGPT
// plan (CODEX_HOME holds auth.json + thread sessions). Internal only — the api container
// is the sole caller and does the auth; never publish this port.
//
//   POST /turn  { prompt, instructions, threadId?, person }  → NDJSON stream of
//               { status } | { delta } | { threadId } | { error } … then { done: true }
//   GET  /health → { ok, loggedIn }
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { Codex } from '@openai/codex-sdk'

const PORT = Number(process.env.PORT ?? 8090)
const CONTEXT_DIR = process.env.CONTEXT_DIR ?? '/context'
const MCP_ENTRY = process.env.MCP_ENTRY ?? '/app/mcp/dist/index.js'
const CODEX_HOME = process.env.CODEX_HOME ?? join(process.env.HOME ?? '/root', '.codex')

const threadOptions = {
  workingDirectory: CONTEXT_DIR,
  skipGitRepoCheck: true,
  // Reads the context files; every write goes through the pichci MCP tools.
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  networkAccessEnabled: false,
  webSearchMode: process.env.SOUS_WEB_SEARCH || 'cached',
  modelReasoningEffort: process.env.SOUS_REASONING || 'low',
  ...(process.env.SOUS_MODEL ? { model: process.env.SOUS_MODEL } : {}),
}

/** One Codex per person: the MCP server's env decides whose diary the tools write to. */
function codexFor(person) {
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
            MISE_API_KEY: process.env.MISE_API_KEY ?? '',
            MISE_PERSON: String(person),
          },
        },
      },
    },
  })
}

// Polish status line for the "Sous pracuje…" bubble, by what Codex is doing.
const TOOL_STATUS = [
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

async function runTurn({ prompt, instructions, threadId, person }, send, signal) {
  const codex = codexFor(person ?? 1)
  let thread = threadId ? codex.resumeThread(threadId, threadOptions) : codex.startThread(threadOptions)
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
        thread = codex.startThread(threadOptions)
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
  if (/usage limit|rate limit|429/i.test(message))
    return 'Limit Codexa w planie ChatGPT na teraz się wyczerpał — spróbuj za jakiś czas.'
  return `Sous nie odpowiedział: ${message}`
}

const loggedIn = () => existsSync(join(CODEX_HOME, 'auth.json'))

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, loggedIn: loggedIn() }))
    return
  }
  if (req.method !== 'POST' || req.url !== '/turn') {
    res.writeHead(404).end()
    return
  }

  let body
  try {
    let raw = ''
    for await (const chunk of req) raw += chunk
    body = JSON.parse(raw)
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new Error('prompt')
  } catch {
    res.writeHead(400).end()
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' })
  const send = (obj) => res.write(JSON.stringify(obj) + '\n')
  const abort = new AbortController()
  res.on('close', () => { if (!res.writableFinished) abort.abort() })

  const t0 = Date.now()
  try {
    if (!loggedIn()) throw new Error('not logged in')
    await runTurn(body, send, abort.signal)
  } catch (e) {
    if (!abort.signal.aborted) {
      console.error(`turn failed: ${e.message}`)
      send({ error: friendly(e.message) })
    }
  }
  console.log(`turn person=${body.person} ${body.threadId ? 'resume' : 'new'} ${Date.now() - t0} ms`)
  send({ done: true })
  res.end()
}).listen(PORT, () => console.log(`sous listening on :${PORT}, context ${CONTEXT_DIR}, logged in: ${loggedIn()}`))
