# Pichci MCP server

A small stdio [MCP](https://modelcontextprotocol.io) server that exposes the Pichci
cookbook REST API as first-class tools for Claude Code and Codex:

- recipes — `get_cookbook`, `search_recipes`, `get_recipe`, `add_recipe`,
  `update_recipe`, `set_recipe_nutrition`, `set_recipe_servings`, `add_recipe_image`
- pantry — `get_pantry`, `add_to_pantry` (deltas, e.g. after a receipt),
  `set_pantry_quantities` (absolute amounts), `create_pantry_item`,
  `add_pantry_aliases`, `get_receipt_mappings`, `delete_receipt_mapping`
- shopping — `get_shopping_list`, `add_shopping_items`, `check_shopping_items`,
  `remove_shopping_items`, `clear_shopping_list`
- household supplies (separate list, no pantry link) — `get_supplies` (returns the
  learned "hot" items too), `add_supplies`, `check_supplies`, `remove_supplies`,
  `clear_supplies`
- plan & log — `get_plan`, `set_plan_entry`, `plan_cook_for_days`,
  `preview_plan_shopping`, `add_plan_missing_to_shopping`, `log_cook` (with optional
  pantry deductions, see `get_cook_proposal`), `get_cook_log`, `update_cook_log_entry`,
  `get_pending_cooks` + `dismiss_cook_reminder` (plan entries never logged as cooked)
- food diary (private, per person) — `log_food`, `update_plan_entry`,
  `delete_plan_entry`, `get_food_favorites`, `log_food_favorite`, `get_fridge`,
  `eat_from_fridge`, `discard_fridge_leftovers`
- goal & activity (private, per person) — `get_budget`, `get_progress`, `get_goal`,
  `log_weight`, `get_activity`, `log_workout`

Diary tools act for person 1 unless `MISE_PERSON=<id>` is set (ids follow the
`DIARY_PEOPLE` order). The in-app Sous sets it to the signed-in person.

The exported `./context` folder stays the primary **read** path (open it in your
agent); MCP is the **write / quick-query** path that works from any directory.

Recipe and gallery `imageUrl` values still refer to original uploads. The web
library uses `GET /api/images/{fileName}/card-v1.webp` for cached 640 px WebP
thumbnails. Recipe list responses and MCP tool schemas are unchanged.

## Build

```bash
cd mcp
npm install
npm run build
```

Requires Node 18+. The Pichci app must be running (`docker compose up`) — the server
proxies `http://localhost:5080` (override with the `MISE_API_URL` env var).

Writes require the `MISE_API_KEY` env var — the same secret as in the app's
`.env` (reads work without it; everything works without it when the app runs
with `AUTH_DEV_BYPASS=true`).

## Register

**Claude Code:**

```bash
claude mcp add pichci -e MISE_API_KEY=<your-key> -- node <absolute-repo-path>/mcp/dist/index.js
```

**Codex** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.pichci]
command = "node"
args = ["<absolute-repo-path>/mcp/dist/index.js"]
env = { MISE_API_KEY = "<your-key>" }
```

The Profile screen in the app (card "Połącz agenta") renders these snippets with
your real paths filled in.
