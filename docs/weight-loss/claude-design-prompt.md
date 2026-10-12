# Claude Design prompt: Pichci weight-loss calendar

Paste everything below the line into Claude Design. If you can, attach screenshots of the
current **Plan** page (phone and desktop) and of a **recipe** page.

---

## Who this is for

**Pichci** is our private, Polish-language cookbook web app (a PWA used mostly on an Android
phone, sometimes on a desktop). It holds our saved recipes, a pantry that counts quantities,
a shopping list and a weekly meal plan. An AI assistant can read and write all of it.

One of us has started losing weight. She wants the **Plan** calendar to show what she actually
ate, against a daily calorie budget, including sweets, small bites and the calories her
Xiaomi band records for workouts.

This is **not** a generic calorie-counter app. It's a cookbook that now also knows about
calories. Keep the cookbook's editorial look. Avoid fitness-app clichés: neon gradients,
gamified badges, flames, cartoon icons, and red guilt colours for going over.

**Tone:** calm, encouraging, factual. Going over budget is information, not a failure.

All UI copy is **Polish**. Use the strings given below and write more in the same voice:
informal, short, second person feminine where needed („zjadłaś”).

## Existing design language (keep it exactly)

The app was redesigned with you in October 2026. New screens must look like they were always
part of it.

**Look:** warm paper background, **1 px ink rules instead of cards**, one terracotta accent,
generous whitespace, editorial typography. The app is light only, with no dark mode. The only
dark surfaces are the AI chat panel (espresso) and the full-screen cook mode.

**Colour tokens**

| token | value | use |
|---|---|---|
| `--bg` | `#f5f0e6` | page paper |
| `--surface` | `#fbf8f2` | inputs, highlighted cells |
| `--seg-bg` | `#ebe3d5` | segmented-control track |
| `--border` | `#ddd3c3` | thin rule between rows |
| `--border-2` | `#c9bca8` | dashed placeholders („+ Dodaj”) |
| `--rule` | `#1d1813` | strong 1 px rule under headers / around strips |
| `--text` | `#1d1813` | ink |
| `--text-2` | `#5e5448` | secondary |
| `--text-3` | `#7a6f61` | muted labels |
| `--accent` | `oklch(0.58 0.19 33)` | terracotta, primary buttons, active tab marker |
| `--accent-text` | `oklch(0.52 0.19 33)` | accent as text |
| `--accent-soft` | `#f6dfd5` | highlighted stat cell |
| `--sage` | `oklch(0.55 0.09 135)` | "done / have it / checked" |
| `--gold` | `oklch(0.7 0.13 75)` | "low" state, stars |
| `--panel-bg` | `#26201a` | espresso AI panel |

Add new tokens only if you have to (for example a muted "remaining budget" tint), and name them
in the same style.

**Type**
- **Newsreader** (serif, weight 500) for page titles (64 px desktop / 44 px phone, letter-spacing
  −0.03em), section heads (22 px) and day names. Dates sit next to them in *italic* `--text-3`,
  e.g. **Wtorek** *14 paź*.
- **Schibsted Grotesk** for UI text: 14–15 px body, 600 for buttons.
- **JetBrains Mono** for every number (kcal, grams, weights, counts) and for **eyebrow labels**:
  11 px, uppercase, letter-spacing .1em, `--text-3`, e.g. `ŚNIADANIE`, `W LODÓWCE`.

**Components we already have** (reuse them, don't reinvent)
- `PageTitle`: big serif title, optional mono superscript count, a subtitle paragraph, and a
  slot for right-aligned controls.
- `SectionHead`: serif title plus right-aligned mono meta, sitting on a strong ink rule.
- `StatStrip`: equal columns between two strong rules, each a big mono number over a small
  label. One cell can be highlighted with `--accent-soft`.
- `Button` variants:
  - primary: terracotta fill, white text;
  - dark: ink fill;
  - outline: 1 px ink border;
  - quiet: 1 px `--border`;
  - text.
  Heights are 38 (pill), 46, 50 and 54 px, with 12 px radius.
- `Chip`: pill; active = ink fill.
- `Segmented`: pill segments on a `--seg-bg` track.
- `UnderlineTabs`, `Toggle` and `SearchField` are also available.
- `Sheet`: every editor and picker opens here. It's a bottom sheet on phones and a centred
  dialog (~480 px) on desktop.
- **No icon set.** Use text, typographic marks (✓ · › + −) and small coloured dots. Recipe
  thumbnails are photos or a typographic placeholder.

**Shell**
- **Desktop:** left `Sidebar` with Przepisy, Losuj, Plan, Zakupy, Spiżarnia, Historia, Profil
  kulinarny.
- **Phone (≤700 px):** bottom `TabBar` with 5 text-only tabs: **Przepisy · Plan · Zakupy ·
  Spiżarnia · Ja**. The active tab gets a 3 px terracotta line on top. Pages that need a
  persistent action pin a full-width 54 px button just above the tab bar.

**How the Plan page looks today**
- **Desktop:** a 7-column week grid. Days run along the top, with **today's column filled in
  ink** and paper text. Rows are ŚNIADANIE / OBIAD / KOLACJA.
- **Cells:** a cell holds a recipe thumbnail + title, or a dashed „+ Dodaj”. Under each day name
  is a mono line like `~1840 kcal · B 92 g`.
- **Phone:** a horizontal day picker, then each day as a serif day name with slot rows below it.
  A pinned button reads „Dodaj brakujące składniki do zakupów”.
- **Navigation:** week arrows „‹ Poprzedni / Dziś / Następny ›”.

## What to design

Use realistic sample data:
- **Her:** 31 years old, 168 cm, 71,2 kg now, goal 64 kg, pace −0,5 kg/week.
- **Daily target:** **1 650 kcal**. Protein goal 110 g.
- **Today, Wednesday 14 Oct:**

| slot | item | portion | kcal | status |
|---|---|---|---|---|
| Śniadanie | Owsianka z jabłkiem i cynamonem | 1 | 380 | eaten |
| Obiad | Gulasz wołowy z papryką, leftover from Monday | — | 520 | eaten |
| Przekąski | Kinder Bueno | 43 g | 245 | eaten |
| Przekąski | Latte na mleku owsianym | — | 120 | eaten |
| Kolacja | Sałatka z tuńczykiem i jajkiem | — | 410 | planned |

- **Activity:** the band synced 7 412 steps and a 45-minute „Trening siłowy”, 310 kcal active.
  The budget adds back 50 % of active kcal (+155), so today's budget is 1 805 kcal.

### 1. Plan → **Dzień** (new main phone view, the most important screen)
The Plan tab gets a **Dzień / Tydzień** switch (`Segmented`). Dzień is the default on phones.
- **Budget header**
  - Eaten 1 265 / budget 1 805, **zostało 540 kcal**.
  - Show how the budget is built: `1 650 cel + 155 aktywność`.
  - Protein progress, e.g. `B 74 / 110 g`.
  - Choose the visual form yourself (ring, bar, ruled strip). It should still read as part of
    this editorial system: thin rules, mono numbers, maybe a single accent fill.
- **Slots:** ŚNIADANIE, OBIAD, KOLACJA, PRZEKĄSKI, each with its own kcal subtotal.
  - Items show a thumbnail (recipes only), a title and mono kcal. Show portion size when it
    isn't 1 (×1,5) and grams for products.
  - **Eaten vs planned** must be obvious at a glance. A planned item has a quick „Zjedzone”
    tick.
  - A leftover shows its source: *„resztki z poniedziałku”*.
  - A recipe without a kcal estimate shows „brak kcal”.
- **„W lodówce” strip:** e.g. *Gulasz wołowy · 1 z 4 porcji* and *Zupa krem z dyni · 2 z 3
  porcji*, each with a one-tap „Zjem porcję” action.
- **Activity line:** `7 412 kroków · Trening siłowy 45 min · 310 kcal`, plus a small „z
  opaski” marker and the sync time („zsynchronizowano 12:40”).
- **Quick-add entry point:** a pinned primary button „+ Dodaj jedzenie” above the tab bar.
  Swiping or arrows move between days.

### 2. Plan → **Tydzień**
The existing week grid (desktop) and day list (phone), extended:
- a **Przekąski** row/slot;
- **multiple items per cell**;
- leftover entries that clearly belong to the cook day. Consider a thin connector or a shared
  mark, e.g. Gulasz cooked Mon dinner, eaten Tue + Wed lunch;
- each day's **kcal against the budget**, e.g. a tiny under/around/over bar under the day name;
- the shopping button stays. It must be clear that leftovers aren't bought again.

### 3. Sheet: **„Gotuję na kilka dni”** (split a cook across days)
Opened from a recipe („Zaplanuj”/„Ugotowane!”) or from a planned cell.
- A portion count stepper: `4 porcje`.
- Below it, a list of assignments: `Pon · Kolacja · gotuję` (fixed first row), `Wt · Obiad`,
  `Śr · Obiad`, „+ Dodaj dzień”.
- A running counter: „zostaje 1 porcja → W lodówce”.
- kcal per portion shown once (`520 kcal / porcja`).
- Confirm: „Zaplanuj 3 dni”.

### 4. Sheet: **„Szybki wpis”** (sweets and small bites)
- A slot picker at the top (defaults to Przekąski).
- **Favourite chips**, frequent first: `Kinder Bueno 245`, `Latte 120`, `Jabłko 80`,
  `Wafelek Prince Polo 180`, `Garść orzechów 190`. One tap logs.
- A manual form: nazwa, kcal. Then **„na porcję” / „na 100 g”** (`Segmented`); per 100 g needs a
  grams field. Optional B / T / W macros. A „Zapamiętaj jako ulubione” toggle.
- **„Skanuj kod”** opens a camera viewfinder state with a scanning frame and a hint.
- An **OpenFoodFacts result** state: product name, brand and kcal/100 g, plus a grams input with
  the live kcal (`43 g → 245 kcal`). Cite the source with small text: „dane: Open Food Facts”.
- Also design: a „nie znaleziono” state with a manual fallback, and a „Wpisz kod ręcznie”
  option.
- Recipes also need a path in: a search that adds a saved recipe with a portion size.

### 5. **Postępy** (progress)
- A weight chart over 8–12 weeks with:
  - daily weigh-ins as small dots;
  - a **7-day trend line**;
  - a dashed goal line at 64 kg.
  Sample: 74,0 → 71,2 kg over 8 weeks, noisy daily values.
- A `StatStrip`: `71,2 kg teraz`, `−0,4 kg / tydz.`, `−2,8 kg od startu`, `~14 tyg. do celu`.
- **This week:** average intake, average budget, total deficit, estimated loss
  (`−2 450 kcal ≈ −0,3 kg`), and a logging streak (`12 dni z rzędu`).
- A quick „Dodaj wagę” action that opens a sheet with one large mono number input.
- Choose where Postępy lives (see the navigation question below).

### 6. **Twój cel** (body profile and target setup)
- A short form:
  - płeć;
  - rok urodzenia;
  - wzrost;
  - aktualna waga;
  - waga docelowa;
  - aktywność na co dzień (Segmented: siedząca / lekka / umiarkowana / wysoka);
  - tempo (−0,25 / −0,5 / −0,75 kg tyg.).
- A live readout: `Podstawowa przemiana 1 450 · Całkowita 2 200 · Cel 1 650 kcal`. The target
  can be overridden by hand.
- A slider or segmented control for „Doliczaj aktywność z opaski: 0 / 50 / 100 %”.
- Make it feel like setup, not a medical form. Can be a sheet or a section of the „Ja” page.

### 7. **Aktywność** (detail and band connection)
- Today and the last 7 days: steps, active kcal and workouts (type, minutes, kcal), each marked
  „z opaski” or „ręcznie”.
- „+ Dodaj trening” manual sheet.
- A connection status block for the band sync:
  - Name the chain once in small text: „Opaska → Mi Fitness → Health Connect → HC Webhook →
    Pichci”.
  - States: **connected** („ostatnia synchronizacja 12:40”), **stale** („brak danych od 2
    dni”, with a hint to open Mi Fitness), and **not set up**. The not-set-up state shows the
    webhook URL to copy and 3 short setup steps.

## States to cover

- An **empty day**: nothing logged yet, encouraging, a single clear action.
- **Over budget:** e.g. 1 980 / 1 805. Use neutral ink or gold, never alarm red. Copy like
  „175 kcal ponad budżet. Jutro nowy dzień.”
- A day with **planned meals only** (future day). It shows the planned total against the
  budget, visually distinct from eaten.
- A recipe **without a kcal estimate** inside the day total: the total shows `~` and a note.
- **Anonymous visitor:** diary, weight and activity are private. Show a quiet locked
  placeholder („Dziennik jest prywatny — zaloguj się”), while recipes stay browsable.
- **Phone with the bottom tab bar plus a pinned action:** make sure nothing collides.

## Navigation question (please propose)

The phone tab bar has exactly 5 text tabs: Przepisy · Plan · Zakupy · Spiżarnia · Ja. Where
should the **day diary**, **Postępy** and **Aktywność** live? Options we see:
- (a) Plan becomes **Dziennik** with Dzień / Tydzień, Postępy and Aktywność inside it;
- (b) Plan stays, and Postępy and Aktywność go under „Ja”;
- (c) your call.

Show the choice on the phone tab bar and the desktop sidebar.

## Deliverables

- Every screen above at **390 px phone** width (primary). Give the Dzień, Tydzień and Postępy
  screens a **1280 px desktop** version too (sidebar shell).
- The sheets in both their bottom-sheet (phone) and dialog (desktop) forms, at least for Szybki
  wpis.
- A short component note for anything new (budget meter, eaten/planned item row, leftover
  marker, fridge strip, weight chart style), so it can be built with inline styles and the
  tokens above.
- Package it as a **handoff bundle**: screens + notes + any new tokens, like the previous Pichci
  redesign handoff.
