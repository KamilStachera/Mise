# Pichci / CukBuk — repository guide for coding agents

This file applies to the whole repository and is the entry point for Codex and
other agents working from the repository root. More specific `AGENTS.md` files
add instructions for their own subtree.

## Start here

Choose the track that matches the request before making changes:

- **Application code, architecture, tests, deployment:** read `CLAUDE.md`
  completely. It is the detailed developer guide and the canonical description
  of the architecture and invariants.
- **Recipes, pantry, shopping, meal plans, cook log, or kitchen profile:** read
  `context/AGENTS.md` completely, then read the context files it prescribes in
  order. `context/api.md` is the REST contract.
- **A task that mixes code and live cookbook data:** read both guides. Keep code
  changes and data mutations as separate, explicit steps.

Before editing, inspect `git status --short` and preserve all unrelated changes
and untracked files. Do not assume a dirty worktree belongs to the current task.

## Repository map

- `backend/` — .NET 9 minimal API, EF Core, PostgreSQL.
- `backend.tests/` — backend regression and unit tests.
- `frontend/` — React, Vite, and TypeScript.
- `mcp/` — stdio MCP server that proxies the REST API.
- `context/` — generated, user-specific culinary memory and API instructions.
- `docker-compose.yml` — local application stack and persistent data volumes.

UI copy and culinary data are Polish. Code, API contracts, commit messages, and
developer documentation are English. Reuse labels from
`frontend/src/lib/labels.ts` and Polish locale-aware sorting where applicable.

## Non-negotiable safety rules

- Docker volumes contain the user's real recipes, pantry, history, and images.
  Never run `docker compose down -v`, delete volumes, wipe the database, reseed,
  restore a dump, or perform bulk destructive data operations without explicit
  user permission.
- Never hand-edit anything under `context/`. These files are generated and are
  overwritten after successful API writes. Agent-facing generated documentation
  comes from `backend/Services/AgentDocs.cs`.
- Treat `.env`, API keys, OAuth secrets, database dumps, and exported data as
  sensitive. Never print or commit secret values. `.env` is intentionally
  ignored by Git.
- Do not commit, push, deploy, restart public services, or mutate pichci.com
  unless the user explicitly asks for that action. A request to change code does
  not imply permission to deploy it.
- Confirm the intended target before data writes: local API, local Docker stack,
  or pichci.com. Do not silently substitute one environment for another.
- Preserve unrelated user work. Do not reset, clean, delete, or overwrite files
  merely to obtain a clean worktree.

## Code-change workflow

1. Read the relevant implementation and its callers before editing. Start from
   `Domain/Entities.cs` for domain invariants and from the relevant endpoint,
   service, frontend hook, or MCP tool for the feature surface.
2. Diagnose the root cause. Prefer a small coherent fix over endpoint-specific
   workarounds when an invariant belongs in a shared service.
3. Add or update regression coverage for bugs. Include the failing scenario and
   a guard against the closest plausible regression.
4. Keep contracts synchronized. When an endpoint or DTO changes, check all of:
   backend endpoint/DTO, frontend client and hooks, context export,
   `backend/Services/AgentDocs.cs`, MCP schemas in `mcp/src/index.ts`, and relevant
   READMEs.
5. Verify in proportion to risk, then review `git diff --check`, `git status`, and
   the scoped diff. Report unrelated pre-existing changes separately.

Important application invariants are described in detail in `CLAUDE.md`. In
particular, do not bypass these:

- Pantry is also the ingredient catalog; quantity `0` means known but absent.
- Pantry status is derived, never written directly.
- Receipt adjustments are deltas; inventory updates are absolute quantities.
- Pantry adjust/bulk endpoints match only and do not create catalog rows.
- The shopping list is intentionally independent from pantry stock.
- `PUT /recipes/{id}` is a full replacement, not a patch.
- Recipe display quantities and structured amounts serve different purposes.
- Frontend `YYYY-MM-DD` values must use `frontend/src/lib/dates.ts`.

## Live cookbook and MCP/API operations

For culinary tasks, follow `context/AGENTS.md` and `context/api.md`, not guesses
from the UI. Prefer configured Pichci MCP tools; use the REST API when MCP is not
available or when its running process lacks current authentication.

- Read the current recipe/pantry state immediately before deciding or writing.
- Writes require `X-Api-Key: MISE_API_KEY` unless an explicitly local environment
  uses `AUTH_DEV_BYPASS=true`. Read the key from environment/configuration without
  echoing it.
- For a receipt, send one `/pantry/adjust` request with purchase deltas. Map to
  existing catalog names first. Add aliases for genuine variants; create a new
  catalog item only for a real new staple.
- For a fridge/pantry inventory, use `/pantry/bulk` with absolute quantities.
- When updating a recipe, send every required field because the endpoint is
  full-replace. Re-read the recipe afterward to verify the stored result.
- Do not edit generated context as a shortcut; successful API writes regenerate
  it automatically.

## Verification commands

Run the smallest relevant set, escalating to end-to-end checks for cross-layer
or risky changes:

```powershell
# Backend and regression tests
dotnet test Mise.sln --nologo

# Frontend type-check and production build
Set-Location frontend
npm run build

# MCP schema/server build
Set-Location mcp
npm run build
```

For full-stack verification, follow `.claude/skills/verify/SKILL.md`. Its Docker
and UI procedure is a verification playbook for this repository. Building the
stack must use `docker compose up -d --build` to avoid stale images. Never use
the destructive `-v` variant without explicit permission. Clean up test data
created in the real database.

## Completion and handoff

At the end of a code task, state:

- what behavior changed and where;
- which verification commands passed;
- any assumptions, warnings, or unverified surfaces;
- whether the change is only local or was also deployed;
- whether a restart, migration, MCP rebuild, or context regeneration is needed.

At the end of a data task, state the target environment, what records changed,
the important quantities/assumptions, and the result of the verification read.

