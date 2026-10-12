# Weight-loss upgrade — feature set

Status: **agreed** (2026-10-12). Design: `design/README.md` + screenshots in `design/`.

Pichci was built so we buy exactly what we cook. Now one of us wants to lose weight, so
the calendar ("Plan") has to become a place where she sees **what she actually ate**,
how that compares to a **daily calorie budget**, and **what she burned** — without turning the
app into a generic calorie counter. Recipes, pantry and shopping stay the heart of it.

Decisions already made:

- She uses an **Android** phone with a **Xiaomi Smart Band 9 Pro** (Mi Fitness app).
- Sweets/snacks are logged by **manual kcal with favourites** and by **barcode scan**.
- When she cooks a pot for several days, the portions are **mostly hers**.
- Diary, weight and activity are **private** — hidden from anonymous visitors of pichci.com
  (recipes stay public).

## What's wrong today

| Problem | Why |
|---|---|
| A dish cooked for 2–3 days shows as one day | A plan slot holds one meal, no portions; cooking doesn't touch the plan at all |
| Planning the same pot on 3 days would triple the shopping list | Every planned recipe is treated as a separate cook |
| Sweets and small bites have nowhere to go | Only Śniadanie / Obiad / Kolacja, one item each, recipes or free text without kcal |
| No sense of "how am I doing today" | Day kcal is a rough sum of one serving per planned recipe; no target, no weight, no activity |

## Features

### F1. Gotuję na kilka dni — one cook, several days
- Cooking (or planning) a recipe asks for the number of portions — already the servings
  picker on the recipe — and lets her **spread them over days and slots**:
  *Gulasz ×4 → pon. kolacja (gotuję) · wt. obiad · śr. obiad · 1 porcja zostaje*.
- Follow-up days are **resztki** linked to the cook day: shown as *„z poniedziałku”*,
  **bought once** (shopping ignores them), cooked ✓ inherited from the cook day.
- **W lodówce** strip: what's left from recent cooks (*Gulasz · 1 z 4 porcji*), one tap
  = *„zjadłam porcję”* into the current slot. A leftover can be marked *wyrzucone*.

### F2. Dziennik — the day as eaten
- Slots: **Śniadanie · Obiad · Kolacja · Przekąski**; any slot can hold several items.
- Every item is **planned** or **eaten**. Ticking a planned meal makes it eaten; portion size
  0.5 / 1 / 1.5 / custom.
- Eaten items keep a **snapshot** of kcal and macros, so editing a recipe later never
  rewrites past days.
- Recipes without a kcal estimate show a clear „brak kcal” marker (an agent can backfill).

### F3. Szybki wpis — sweets & small bites
- Name + kcal (macros optional), either per portion or per 100 g × grams eaten.
- **Favourite chips** — the things she logs often (*Snickers 250 kcal*, *Latte 120 kcal*),
  ranked like the Dom „hot items”: pinned first, then recent frequency.
- **Barcode scan** (phone camera in the browser): looks the product up in
  **OpenFoodFacts** (good Polish coverage), fills name + kcal/100 g + macros; she enters grams.
  Scanned products become favourites. Typed barcode as fallback.

### F4. Budżet dnia — daily target
- Short body profile: sex, birth year, height, current and goal weight, everyday activity
  level, pace (−0.25 / −0.5 / −0.75 kg per week). Pichci computes BMR → TDEE → target
  (Mifflin-St Jeor); she can override the number. The target is **fixed** (same every day).
- Day view: **eaten / target / remaining** plus a **protein target** (it matters most when
  cutting).
- Week view: each day against the target (under / around / over).

### F5. Postępy — progress
- **Daily** weigh-in, ideally automatic from the **Xiaomi Smart Scale 2** through the same
  Health Connect pipe as the band (see F6). Manual entry stays as a fallback.
- Weight log (one number per day, morning) with a **7-day trend line** — the daily number
  jumps around, the trend is what counts. Goal line, weekly change, rough ETA.
- Weekly summary: average intake, total deficit, estimated loss (7700 kcal ≈ 1 kg),
  logging streak.

### F6. Aktywność — what she burned
- **Manual** entry: workout type, minutes, kcal.
- **Automatic from the band and scale** (Android):
  Band 9 Pro / Smart Scale 2 → Mi Fitness → **Health Connect** → **HC Webhook** (free,
  open-source Android app) → Pichci. Brings **active kcal, workouts and weight** every
  15–60 min. Steps are not shown. One-time setup on her phone (~1 h together).
  - Still to check on her phone: that Mi Fitness actually writes scale **Weight** to Health
    Connect. If it doesn't, the fallback is **openScale** (open-source, reads the Mi Scale 2
    over Bluetooth) with its Health Connect sync.
- The budget gets back **part of the burned kcal** (default 50 % — band estimates run high;
  adjustable).
- Ruled out: Google Fit (shuts down end of 2026), unofficial Xiaomi cloud APIs (break without
  warning). Strava only as a fallback for workouts.

## Order of work

1. ~~**Design**~~ — done, see `design/README.md` and the screenshots in `design/`.
2. ~~**P1 Kalendarz**~~ — F1, F2, F3 (without barcode). Done 2026-10-12.
3. ~~**P2 Budżet i postępy**~~ — F4, F5, privacy. Done 2026-10-12.
4. ~~**P3 Skaner**~~ — barcode + OpenFoodFacts. Done 2026-10-12.
5. ~~**P4 Aktywność i waga z urządzeń**~~ — done 2026-10-12: manual workouts, Health Connect sync (band +
   scale) and phone setup.

**Deferred:** AI features (diary in the context folder, MCP tools for logging food and
weight, „co zjeść, zostało mi X kcal”). We'll come back to these later.

## Her answers (2026-10-12)

- Fixed daily target — yes.
- Show kcal **and** a protein target.
- Weigh in daily, automatically from the Xiaomi Smart Scale 2 if possible.
- From the band: **active kcal and workouts only**, no steps.
