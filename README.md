# Pichci — AI-Assisted Cookbook

A personal cookbook that keeps your recipes, your pantry, and your cooking
preferences in one place — and turns all of it into context an AI can use to
help plan meals.

- **Recipes** from AI, the web/books, or your own — with photos (a small gallery
  per recipe), dish-type / cuisine / time / air-fryer filters, and a live "what
  you'd need to buy" badge based on your pantry. An "almost complete" toggle and
  a "fewest missing" sort surface the recipes you could cook after buying 1–2
  things.
- **Progressive recipe browsing:** the library reveals 24 cards at a time as you
  scroll, with a "Pokaż więcej" fallback. Search, counts, filters and sorting still
  use the complete recipe metadata. Card photos are lazy-loaded WebP thumbnails
  (640 px maximum edge, quality 78), generated on demand for existing and new
  uploads and cached in `ImagesDir/card-v1`. Originals and gallery URLs are kept.
  No database migration or image backfill is required; rebuild the API and web
  to enable this. The image cache persists in the existing images volume.
  Browser regression coverage: `cd frontend && npm run test:library` (Node 20+
  and installed Microsoft Edge; `PLAYWRIGHT_CHANNEL` can select another installed
  Playwright browser channel). Tests use 300 fixture recipes without a live API.
- **Per-serving nutrition estimates** (kcal / protein / fat / carbs) on every
  recipe — agents estimate them when saving, the plan shows per-day totals.
- A full-screen **cook mode** ("Tryb gotowania"): one step at a time in large
  type, tappable countdown timers parsed from the step text, and a screen wake
  lock so the display stays on at the stove.
- **Phone-friendly**: below tablet width the nav becomes a bottom tab bar and the
  shopping list gets store-sized tap targets; a minimal PWA manifest lets you
  install it to your home screen (open `http://<host-ip>:8080` on the same LAN).
- An **approximate quantity pantry** (grams / ml / pieces) that keeps a visible
  estimate plus a conservative planning amount. Receipt labels can be learned per
  store, cooking tolerates small deviations, and only shopping-relevant uncertainty
  asks for a quick confirmation.
- A **Shopping list** that is deliberately independent of the pantry — items come
  from recipes ("add what's missing"), from you, or from agents. Recipe-origin
  rows merge by canonical pantry item and sum compatible quantities; manual rows
  stay independent. Explicit ingredient alternatives create one "A or B" row and
  are satisfied by any sufficiently stocked option.
- A second **household list** ("Dom") on the same screen, for the non-food half of
  the trip — toilet paper, dish soap, bin bags. Name-only rows, categories guessed
  from the name, and no connection to the pantry or the food list whatsoever. It
  learns what you buy most often and offers those as one-tap chips; you can pin
  something so it always shows, or hide it for good.
- A **Cooking Profile** + a detailed **kitchen questionnaire** (30 questions) that
  compile into a `cookbook.md` memory file.
- A **weekly meal plan** and a **cook log** ("we made this — too salty") that
  agents read and write, closing the feedback loop. Logging a cook can deduct the
  used ingredients from the pantry (the app proposes the amounts).
- A **dinner roulette** ("Losuj") that picks tonight's meal by your rules, and a
  **cooking history** ("Historia") with stats, streaks and repeat badges.
- **Primary AI path:** an exported `./context` folder you open with **Codex**
  ("Sign in with ChatGPT") or **Claude Code** — covered by your existing
  subscription, no API key or extra cost. Agents read the folder and **write back
  through the REST API** (add a recipe from a photo, update the pantry from a
  receipt, fill the weekly plan).
- An optional **MCP server** (`mcp/`) exposing the same operations as first-class
  agent tools.
- **Optional in-app "Sous" chat** (off by default) if you'd rather wire up an
  OpenAI key or a local Ollama model.

Stack: ASP.NET Core (.NET 9, minimal APIs) + EF Core + PostgreSQL · React + Vite +
TypeScript · all containerized with Docker Compose.

The UI and all content (seed recipes, pantry, exported AI context) are in **Polish**;
ingredient↔pantry matching is Polish-aware (diacritics + inflection, so "czosnku"
matches "Czosnek"). Recipe ingredients keep that canonical product separately
from an optional verbatim display line. Alternatives are separate ingredient rows
sharing an `alternativeGroup`, never a slash inside the product name. Code, API
contracts and this README stay in English.

---

## Run it

Requires Docker Desktop.

```bash
cp .env.example .env        # defaults work out of the box
docker compose up --build
```

Then open **http://localhost:8080**.

- The database is migrated and seeded automatically on first start.
- Swagger: **http://localhost:8080/api/swagger** (also on http://localhost:5080/api/swagger).
- The `./context` folder on your host is filled with your cooking context (see below).

To stop: `docker compose down` (add `-v` to also wipe the database volume).

---

## The AI workflow (primary path)

Every data change (recipes, pantry, plan, cook log, shopping, preferences — plus
the **Sync** button on the Profile screen) rewrites a folder you can hand to an
AI agent:

```
context/
  cookbook.md        # profile + questionnaire + rules + pantry snapshot + recipe index
  pantry.json        # ingredient catalog with estimates, planning quantities and confidence
  plan.md            # this week's + next week's meal plan
  cooklog.md         # what you cooked and how it went (the feedback loop)
  shopping.md        # current to-buy list
  supplies.md        # household list (chemia / higiena / papier) + frequent items
  recipes/*.md       # one file per recipe (with a per-recipe cooking history)
  AGENTS.md          # instructions Codex reads automatically
  CLAUDE.md          # instructions Claude Code reads automatically
  api.md             # full REST reference with curl examples (how agents write back)
  commands/*.md      # ready-made slash commands to copy into your agent config
```

Open that folder with **Codex** or **Claude Code** and just talk to it
("what should I cook tonight?", "plan three weeknight dinners"). Because
`AGENTS.md`/`CLAUDE.md` point it at `cookbook.md` and `pantry.json` first, it
already knows your kitchen, your tastes, and what you'd need to buy.

**Reading is file-based; writing goes through the REST API** (`http://localhost:5080/api`,
documented in `context/api.md`). The context files are regenerated on every change —
agents must never edit them directly, and `AGENTS.md` says so. Typical flows the
instructions cover: *recipe photo → `POST /recipes`*, *receipt → `POST /pantry/adjust`
(deltas + learned raw-name mappings)*, *fridge photo → `POST /pantry/bulk` (absolute amounts)*,
*"plan my week" → `PUT /plan/entry` + a focused shopping review*, *"we cooked it" →
`POST /cooklog` (optionally deducting used ingredients)*.

## Connecting an agent

The **Profile → "Połącz agenta"** card renders all of these with your real paths,
each with a copy button:

1. **One-shot prompt** — paste into any Codex/Claude Code session; points the agent
   at the context folder and the API.
2. **Global snippet** — append to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`
   so *every* session knows where your cookbook lives.
3. **Slash commands** — copy `context/commands/*.md` to `~/.claude/commands/` and
   `~/.codex/prompts/`, then use `/dodaj-przepis <photo>`, `/paragon <photo>`,
   `/zaplanuj-tydzien`.
4. **MCP server** — see below.

Set `HOST_CONTEXT_DIR` in `.env` (the absolute host path of `./context`) so the
prompts come out ready to paste; otherwise the card asks for the path once.

> **Security note:** the app enforces access control in the backend itself:
> anonymous visitors get **read-only** access (all GETs except the AI chat and
> the context-integration endpoints), while every write requires either a
> logged-in **Google account from the whitelist** (`AUTH_ALLOWED_EMAILS`) or the
> **`X-Api-Key` header** (`MISE_API_KEY`) used by agents and the MCP server.
> For a friction-free local dev loop set `AUTH_DEV_BYPASS=true` in `.env`
> (the `.env.example` default) — never do that on an internet-exposed machine.
> See **Going public** below for exposing the app beyond your LAN.

## MCP server

`mcp/` contains a small stdio MCP server that proxies the REST API as tools
(`add_recipe`, `add_recipe_image`, `add_to_pantry`, `set_pantry_quantities`,
`preview_plan_shopping`, `add_plan_missing_to_shopping`, `set_plan_entry`, `log_cook`, …):

```bash
cd mcp && npm install && npm run build
claude mcp add pichci -e MISE_API_KEY=<your-key> -- node <absolute-repo-path>/mcp/dist/index.js
```

Codex equivalent (`~/.codex/config.toml`):

```toml
[mcp_servers.pichci]
command = "node"
args = ["<absolute-repo-path>/mcp/dist/index.js"]
env = { MISE_API_KEY = "<your-key>" }
```

The app must be running; the server talks to `http://localhost:5080`
(override with `MISE_API_URL`). Writes require `MISE_API_KEY` — the same value
as in the app's `.env` (not needed if the app runs with `AUTH_DEV_BYPASS=true`).
See `mcp/README.md`.

## Optional: in-app chat

The "Sous" panel is built but disabled until you choose a provider in `.env`:

```ini
# OpenAI (pay-as-you-go API key — separate from a ChatGPT subscription)
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# …or a local model
# AI_PROVIDER=ollama
# OLLAMA_BASE_URL=http://host.docker.internal:11434
# OLLAMA_MODEL=llama3.1
```

Restart (`docker compose up -d`) and the panel turns on. It streams replies with
your `cookbook.md` + live pantry injected as the system prompt.

---

## Going public (internet access)

The stack ships with an opt-in **Cloudflare Tunnel** service so the app can be
reached from anywhere over HTTPS with no port forwarding and no open inbound
ports. Anyone with the URL can browse read-only; editing requires Google login
(whitelisted emails) and agents use the API key.

One-time setup:

1. **Domain on Cloudflare** (free plan). In *Zero Trust → Networks → Tunnels*
   create a tunnel, add a public hostname `https://<your-domain>` →
   `http://web:80`, and copy the tunnel token.
2. **Google OAuth client**: [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   → *OAuth client ID* (Web application) with redirect URI
   `https://<your-domain>/api/auth/google-callback` (add
   `http://localhost:8080/api/auth/google-callback` for local testing).
3. In `.env`: set `TUNNEL_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `AUTH_ALLOWED_EMAILS` (comma-separated), a long random `MISE_API_KEY`,
   `PUBLIC_API_BASE=https://<your-domain>/api` — and **`AUTH_DEV_BYPASS=false`**.
4. Start with the profile: `docker compose --profile public up -d --build`.
   On a shared/VPS host also set `WEB_BIND=127.0.0.1:8080` in `.env` so nginx
   isn't reachable directly — only through the tunnel.

Moving hosts later (e.g. VPS → home server) is just: copy the volumes
(`pg_dump` + images), same `.env`, same tunnel token — DNS and TLS don't change.

---

## Project layout

```
backend/      ASP.NET Core API (Domain, Data, Features/<endpoints>, Services)
frontend/     React + Vite SPA (pages, components, api hooks), served by nginx
mcp/          MCP server exposing the API as agent tools (build with npm run build)
context/      generated AI context (gitignored)
docker-compose.yml
```

## Local development (without Docker for the frontend)

The backend + db still run best in Docker. To develop the UI with hot reload:

```bash
docker compose up db api      # backend on :5080
cd frontend && npm install && npm run dev   # Vite on :5173, proxies /api -> :5080
```
