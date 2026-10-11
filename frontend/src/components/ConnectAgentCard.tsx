import { useState, type CSSProperties } from 'react'
import { useConnectInfo } from '../api/hooks'

const CTX_TOKEN = '{{CONTEXT_DIR}}'
const REPO_TOKEN = '{{REPO_DIR}}'
const LS_KEY = 'mise.hostContextDir'

/** Strip a trailing "context" segment to get the repo root (mcp/ lives next to context/). */
function repoDirOf(ctxDir: string): string {
  return ctxDir.replace(/[\\/]+$/, '').replace(/[\\/]context$/i, '')
}

export function ConnectAgentCard() {
  const { data: info } = useConnectInfo()
  const [manualDir, setManualDir] = useState(() => localStorage.getItem(LS_KEY) ?? '')

  if (!info) return null

  const ctxDir = info.hostContextPath ?? (manualDir.trim() || null)
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
        title="Komendy /dodaj-przepis, /paragon, /zaplanuj-tydzien — skopiuj raz"
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
