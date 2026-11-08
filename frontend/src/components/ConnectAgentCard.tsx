import { useState, type CSSProperties } from 'react'
import type { CreatedApiKey } from '../api/client'
import { useApiKeys, useAuth, useConnectInfo, useHouseholdActions } from '../api/hooks'

const CTX_TOKEN = '{{CONTEXT_DIR}}'
const REPO_TOKEN = '{{REPO_DIR}}'
const LS_KEY = 'mise.hostContextDir'

/** Strip a trailing "context" (or "context/<household>") to get the repo root (mcp/ lives next to context/). */
function repoDirOf(ctxDir: string): string {
  return ctxDir.replace(/[\\/]+$/, '').replace(/[\\/]context([\\/]\d+)?$/i, '')
}

/** Each household's export is a numbered subfolder of the repo's context folder. */
function householdDir(contextRoot: string, household: number | undefined): string {
  const root = contextRoot.replace(/[\\/]+$/, '')
  if (household == null || /[\\/]\d+$/.test(root)) return root
  return `${root}${root.includes('\\') ? '\\' : '/'}${household}`
}

export function ConnectAgentCard() {
  const { data: info } = useConnectInfo()
  const { data: auth } = useAuth()
  const [manualDir, setManualDir] = useState(() => localStorage.getItem(LS_KEY) ?? '')

  if (!info) return null

  const ctxDir = info.hostContextPath ?? (manualDir.trim() ? householdDir(manualDir.trim(), auth?.household?.id) : null)
  const needsPath = !info.hostContextPath

  function substitute(text: string): string {
    if (!ctxDir) return text
    return text.split(CTX_TOKEN).join(ctxDir).split(REPO_TOKEN).join(repoDirOf(ctxDir))
  }

  return (
    <div style={card}>
      <div style={cap}>Połącz agenta (Codex / Claude Code)</div>
      <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '0 0 14px', lineHeight: 1.55 }}>
        Agenci czytają folder <Code>context</Code>, a zapisują przez API pod <Code>{info.apiBase}</Code>.
        Skopiuj to, czego potrzebujesz — jednorazowy prompt, wpis do globalnej konfiguracji,
        komendy <Code>/dodaj-przepis</Code> albo rejestrację serwera MCP.
      </p>

      <ApiKeys />

      {needsPath && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ font: "500 12.5px var(--sans)", color: 'var(--text-2)', marginBottom: 6 }}>
            Ścieżka folderu <Code>context</Code> na tym komputerze (albo ustaw <Code>HOST_CONTEXT_DIR</Code> w .env):
          </div>
          <input
            value={manualDir}
            onChange={(e) => {
              setManualDir(e.target.value)
              localStorage.setItem(LS_KEY, e.target.value)
            }}
            placeholder="np. E:\Ntropy\Repos\CukBuk\context"
            style={input}
          />
        </div>
      )}

      <CopyBlock title="Jednorazowy prompt — wklej do dowolnej sesji agenta" text={substitute(info.prompts.oneShot)} disabled={!ctxDir} />
      <CopyBlock
        title="Na stałe — dopisz do ~/.claude/CLAUDE.md oraz ~/.codex/AGENTS.md"
        text={substitute(info.prompts.globalSnippet)}
        disabled={!ctxDir}
      />
      <CopyBlock
        title="Komendy /dodaj-przepis, /paragon, /zaplanuj-tydzien, /wzbogac-cwiczenia — skopiuj raz"
        text={substitute(info.prompts.commandsInstall)}
        disabled={!ctxDir}
      />
      <CopyBlock
        title="Serwer MCP — Claude Code (wcześniej: npm install && npm run build w mcp/)"
        text={substitute(info.prompts.claudeMcpCommand)}
        disabled={!ctxDir}
      />
      <CopyBlock title="Serwer MCP — Codex (~/.codex/config.toml)" text={substitute(info.prompts.codexMcpToml)} disabled={!ctxDir} />
    </div>
  )
}

/** Personal keys: an agent's MISE_API_KEY acts as you, in your household. Shown once. */
function ApiKeys() {
  const { data: keys } = useApiKeys()
  const actions = useHouseholdActions()
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<CreatedApiKey | null>(null)
  const dateFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' })

  return (
    <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ font: "500 12.5px var(--sans)", color: 'var(--text-2)' }}>
        Klucz API — zapisy agenta idą na twoje konto, w twoim domu. Ustaw go jako <Code>MISE_API_KEY</Code> w konfiguracji agenta / serwera MCP.
      </div>
      {fresh && (
        <CopyBlock
          title={`Nowy klucz „${fresh.name}” — skopiuj teraz, nie zobaczysz go ponownie`}
          text={`MISE_API_KEY=${fresh.key}\n\n# Claude Code:\nclaude mcp add pichci -e MISE_API_KEY=${fresh.key} -e MISE_API_URL=${window.location.origin} -- node <repo>/mcp/dist/index.js\n\n# Codex (~/.codex/config.toml, w [mcp_servers.pichci]):\nenv = { MISE_API_KEY = "${fresh.key}", MISE_API_URL = "${window.location.origin}" }`}
          disabled={false}
        />
      )}
      {(keys ?? []).map((k) => (
        <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 10, font: '400 13px var(--sans)', color: 'var(--text-2)' }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {k.name} <Code>{k.prefix}…</Code>
            <span style={{ color: 'var(--text-3)' }}> · {k.lastUsedAt ? `używany ${dateFmt.format(new Date(k.lastUsedAt))}` : 'jeszcze nieużywany'}</span>
          </span>
          <button onClick={() => actions.revokeApiKey.mutate(k.id)} style={pill}>Unieważnij</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
          placeholder="Nazwa, np. Claude Code na laptopie" style={{ ...input, height: 38, font: '400 13px var(--sans)' }} />
        <button
          style={{ ...pill, whiteSpace: 'nowrap' }}
          disabled={!name.trim() || actions.createApiKey.isPending}
          onClick={async () => {
            setFresh(await actions.createApiKey.mutateAsync(name.trim()))
            setName('')
          }}
        >
          Nowy klucz
        </button>
      </div>
    </div>
  )
}

function CopyBlock({ title, text, disabled }: { title: string; text: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false)

  async function onCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span style={{ font: "500 12px var(--sans)", color: 'var(--text-2)' }}>{title}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onCopy}
          disabled={disabled}
          style={{
            font: "500 11.5px var(--sans)",
            color: copied ? 'var(--sage)' : 'var(--text-2)',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 999,
            padding: '4px 12px',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {copied ? '✓ Skopiowano' : 'Kopiuj'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          font: "400 11.5px var(--mono)",
          lineHeight: 1.55,
          color: disabled ? 'var(--text-3)' : 'var(--text)',
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
          maxHeight: 130,
          overflowY: 'auto',
        }}
      >
        {text}
      </pre>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code style={{ font: "500 12px var(--mono)", color: 'var(--accent-text)' }}>{children}</code>
}

const card: CSSProperties = {
  borderTop: '1px solid var(--rule)',
  paddingTop: 14,
}
const cap: CSSProperties = {
  font: '500 11px var(--mono)',
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  marginBottom: 11,
}
const pill: CSSProperties = {
  font: "500 11.5px var(--sans)",
  color: 'var(--text-2)',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 999,
  padding: '4px 12px',
  cursor: 'pointer',
}
const input: CSSProperties = {
  width: '100%',
  height: 44,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  borderRadius: 12,
  padding: '0 14px',
  font: '400 13px var(--mono)',
  color: 'var(--text)',
}
