# Mise — AI-Assisted Cookbook

A personal cookbook that keeps your recipes, your pantry, and your cooking
preferences in one place — and turns all of it into context an AI can use to
help plan meals.

- **Recipes** from AI, the web/books, or your own — with photos (a small gallery
  per recipe), dish-type / cuisine / time / air-fryer filters, and a live "what
  you'd need to buy" badge based on your pantry.
- A **quantity-based pantry** (grams / ml / pieces, with low-stock thresholds and
  aliases) that doubles as your ingredient catalog — in / low / out is derived
  from the numbers. Receipts add deltas; a fridge photo sets absolute amounts.
- A **Shopping list** that is deliberately independent of the pantry — items come
  from recipes ("add what's missing"), from you, or from agents.
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
matches "Czosnek"). Code, API contracts and this README stay in English.

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
  pantry.json        # ingredient catalog with quantities (g / ml / szt) + derived status
  plan.md            # this week's + next week's meal plan
  cooklog.md         # what you cooked and how it went (the feedback loop)
  shopping.md        # current to-buy list
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
(deltas)*, *fridge photo → `POST /pantry/bulk` (absolute amounts)*, *"plan my week" →
`PUT /plan/entry` + missing ingredients onto the shopping list*, *"we cooked it" →
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

> **Security note:** the API has no authentication. The raw API port is bound to
> loopback only (`127.0.0.1:5080`), so agents and the MCP server on this machine
> can reach it, but other devices cannot. The web app on port `8080` (nginx, which
> proxies `/api`) **is** reachable from your LAN — that's what lets you open the
> shopping list on your phone (`http://<host-ip>:8080`, installable as a PWA) —
> so anyone on your network can read and change your cookbook data through it.
> Fine on a trusted home network; don't expose 8080 beyond it (WAN/port forward).

## MCP server

`mcp/` contains a small stdio MCP server that proxies the REST API as tools
(`add_recipe`, `add_recipe_image`, `add_to_pantry`, `set_pantry_quantities`,
`set_plan_entry`, `log_cook`, …):

```bash
cd mcp && npm install && npm run build
claude mcp add mise -- node <absolute-repo-path>/mcp/dist/index.js
```

Codex equivalent (`~/.codex/config.toml`):

```toml
[mcp_servers.mise]
command = "node"
args = ["<absolute-repo-path>/mcp/dist/index.js"]
```

The app must be running; the server talks to `http://localhost:5080`
(override with `MISE_API_URL`). See `mcp/README.md`.

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
