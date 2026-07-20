# Pichci MCP server

A small stdio [MCP](https://modelcontextprotocol.io) server that exposes the Pichci
cookbook REST API as first-class tools for Claude Code and Codex:

- recipes — `get_cookbook`, `search_recipes`, `get_recipe`, `add_recipe`,
  `update_recipe`, `add_recipe_image`
- pantry — `get_pantry`, `add_to_pantry` (deltas, e.g. after a receipt),
  `set_pantry_quantities` (absolute amounts), `create_pantry_item`,
  `add_pantry_aliases`
- shopping — `get_shopping_list`, `add_shopping_items`, `check_shopping_items`,
  `remove_shopping_items`, `clear_shopping_list`
- plan & log — `get_plan`, `set_plan_entry`, `log_cook` (with optional pantry
  deductions), `update_cook_log_entry`, `get_pending_cooks` +
  `dismiss_cook_reminder` (plan entries never logged as cooked)

The exported `./context` folder stays the primary **read** path (open it in your
agent); MCP is the **write / quick-query** path that works from any directory.

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
