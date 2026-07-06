---
name: verify
description: Build, launch and drive the Mise app (docker compose stack) to verify changes end-to-end at the real UI/API surface.
---

# Verifying Mise (CukBuk) changes

## Build + launch

```powershell
docker compose up -d --build       # from repo root; --build is mandatory or you get stale images
docker logs cukbuk-api-1           # check "Applying migration ..." + "Now listening"
```

- Docker Desktop may be off — start `C:\Program Files\Docker\Docker\Docker Desktop.exe` and poll `docker info` until ready (~1 min).
- EF migrations auto-apply on API boot; seed only runs on an empty DB (`docker compose down -v` for a fresh-seed check — destroys real data, ask first).
- Surfaces: web UI `http://localhost:8080`, API `http://localhost:5080/api` (Swagger UI at `/swagger`).

## Drive the UI (GUI surface)

Playwright with the system Edge browser — no browser download needed:

```powershell
# in a scratch dir
npm init -y; npm install playwright --no-audit --no-fund
```

```js
import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
```

- App text is Polish; select by visible Polish labels (`button:has-text("Zupa")`).
- Delete buttons use `confirm()` — register `page.on('dialog', d => d.accept())`.
- Filter chips animate `transition: all .14s` — wait ~300ms after a click before screenshotting or reading computed styles, or the frame captures the mid-transition color.
- Clean up any recipes/pantry rows you create (the DB volume holds the user's real collection — 60+ recipes).

## Drive the API

`Invoke-RestMethod http://localhost:5080/api/recipes` etc. Error bodies: catch and read `$_.Exception.Response.GetResponseStream()`.

## After mutations

Every successful write regenerates `context/*.md` — check `context/cookbook.md`, `context/recipes/*.md`, `context/api.md` when a change touches agent-facing metadata.
