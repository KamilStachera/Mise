# Handoff: Pichci Dziennik (diary, budget, progress, activity)

## Overview
Adds calorie awareness to the Pichci cookbook PWA without turning it into a calorie counter. The Plan calendar shows what she actually ate against a daily budget (target + 50 % of band-recorded active kcal), handles one cook spread over several days (leftovers), quick logging of sweets/snacks (favourites, barcode via Open Food Facts), weight progress and band activity. Covers features F1–F6 from `docs/weight-loss/features.md`.

## About the design files
`Pichci Dziennik.dc.html` is a **design reference built in HTML** — static mockups showing intended look and behaviour, not production code. Recreate it in the existing frontend (`frontend/src`, React + Vite) using its components (`PageTitle`, `SectionHead`, `StatStrip`, `Button`, `Chip`, `Segmented`, `Sheet`, `TabBar`, `Sidebar`…) and inline styles with the existing tokens. Open the file in a browser; it's a pan/zoom canvas.

## Fidelity
**High-fidelity.** Final colours, type, spacing and Polish copy. Sample data is realistic but fake (see "Sample data").

## Navigation (proposal c)
- Phone tab bar unchanged: **Przepisy · Plan · Zakupy · Spiżarnia · Ja**.
- Plan header gets `Segmented`: **Dzień · Tydzień · Postępy**. Dzień is default on phones (≤700 px), Tydzień on desktop.
- **Aktywność** is a sub-page: opened from the activity line in Dzień and from Postępy (`← Plan` back link).
- **Twój cel** lives in **Ja** (settings), also linked from Postępy.
- Desktop sidebar: Plan expands into indented sub-links Dzień / Tydzień / Postępy / Aktywność (1 px `--border` left rule, active = 3 px accent inset). Twój cel added under TWOJA KUCHNIA.

## Screens
IDs match the badges in the file.

**Plan → Dzień** (phone P1–P6, desktop D1)
- Header: `Plan` 44 px + Segmented. Day nav between two strong rules: 44 px ‹ › hit areas, centred serif day name 24 px + italic date, mono 11 px accent tag („DZIŚ”, „za 2 dni”). Swipe left/right also changes day.
- BudgetMeter (see Components), protein line.
- Slots ŚNIADANIE / OBIAD / KOLACJA / PRZEKĄSKI: eyebrow in ink on a strong top rule, right: mono subtotal + „+ Dodaj” text button. Rows = DiaryItem. Planned subtotal prefixed `~` in `--text-3`.
- FridgeStrip „W lodówce”, then activity line (`7 412 kroków · Trening siłowy 45 min · 310 kcal`, „z opaski” tag, „zsynchronizowano 12:40”, „Do budżetu doliczono połowę: +155 kcal”, › to Aktywność).
- Pinned 54 px primary „+ Dodaj jedzenie” in a bar (padding 12/16/10, `--bg`, 1 px `--border` top shadow) directly above the tab bar. Scroll content needs bottom padding = pinned bar + tab bar (~140 px) so nothing hides behind it.
- Desktop D1: two columns 1.45fr / 1fr, gap 48. Left = meter + slots; right = W lodówce, Aktywność, Ten tydzień (7 WeekDayBars). „+ Dodaj jedzenie” 46 px primary in the title row next to ‹ Wtorek / Czwartek ›.
- States: **P3 empty** (meter full budget, centred italic serif „Czysta kartka.” + one line, single pinned action); **P4 over** (1 980 / 1 805, gold, copy „175 kcal ponad budżet. Jutro nowy dzień.” + weekly context); **P5 future/planned only** (meter mode `plan`, hatched; „brak kcal” item makes the total `~` with a note); **P6 anonymous** (eyebrow PRYWATNE, serif „Dziennik jest prywatny — zaloguj się”, explanation, „Zaloguj się” outline + „Przeglądaj przepisy ›”, skeleton rows at 50 %).

**Plan → Tydzień** (phone P7, desktop D2)
- Phone: 7-day strip between strong rules; each day mono name/number + 4 px WeekDayBar; today = ink pill. Below, each day: serif day name + mono `zjedzone / budżet` (+ „· około” when within ±5 %), rows `SLOT | title (+ CookMark, italic source) | kcal`. Note on leftovers + pinned „Dodaj brakujące składniki do zakupów”.
- Desktop: grid `96px repeat(7, 1fr)`; header cells hold day name, WeekDayBar and mono label; today column ink with paper text, today's cells `--surface`. Rows ŚNIADANIE, OBIAD, KOLACJA, **PRZEKĄSKI**; cells stack multiple items (7 px dot: sage = eaten, dashed ring = planned). Empty cell = dashed „+”. Extra **W LODÓWCE** row: per cook a 1.5 px ink line from cook day to last portion, filled mark + name at start, „zostaje 1” + outline mark at end. Footer: count + „Resztki nie trafiają na listę. Kupujesz raz, na dzień gotowania.” + shopping button.

**Sheets** (phone P8–P15, desktop dialogs D4–D6)
- P8/D6 Gotuję na kilka dni: portions stepper (44 px − / +), `520 kcal / porcja`, assignment rows (first row fixed with „gotuję” tag, others removable ×), dashed „+ Dodaj dzień”, counter box „zostaje 1 porcja → W lodówce” with portion dots, „Składniki kupujesz raz, na poniedziałek.”, primary „Zaplanuj 3 dni” (count = assigned days).
- P9/D4 Szybki wpis: slot Segmented (default Przekąski), favourite chips (name + mono kcal, pinned then by frequency; one tap logs + toast with undo), „Skanuj kod” outline + „Z przepisu” quiet, manual form (Nazwa, kcal, na porcję / na 100 g, optional B/T/W, „Zapamiętaj jako ulubione” toggle), primary shows live total.
- P10 na 100 g: kcal/100 g + grams → live `25 g → 142 kcal` between strong rules.
- P11 camera: full-screen dark (`#14100c`), corner frame 280×170, accent scan line, hint „Nakieruj na kod kreskowy”, „Wpisz kod ręcznie”.
- P12/D5 Open Food Facts result: EAN eyebrow in sage-text, product + brand + kcal/100 g, macros, slot picker, portion chips from OFF serving data, big mono grams input, live `43 g → 245 kcal`, „dane: Open Food Facts”. Scanned products become favourites.
- P13 Nie znaleziono: manual fallback, saved against the barcode. P14 manual code entry with numeric keypad. P15 Z przepisu: search saved recipes, select one → portion chips ×0,5 / ×1 / ×1,5 / inna, live kcal.

**Postępy** (phone P16, desktop D3): StatStrip (71,2 kg teraz highlighted · −0,4 kg/tydz. · −2,8 kg od startu · ~14 tyg. do celu; 2×2 on phone), WeightChart 8/12 weeks, Ten tydzień rows (średnio zjedzone, średni budżet, deficyt łącznie `−2 450 kcal ≈ −0,3 kg`, seria `12 dni z rzędu`), links Aktywność ›, Twój cel ›. Pinned „+ Dodaj wagę” → P17 sheet with a 76 px mono value, ±0,1 steps, yesterday/trend line.

**Ja** (P23): existing Ja page with a new top group „Ty i twój cel” (SectionHead + „tylko dla ciebie” tag): Twój cel `1 650 kcal` / `71,2 → 64 kg · −0,5 kg / tydz.`, Opaska (SourceTag „połączona”, last sync), Postępy (`−2,8 kg`, streak). Historia / Fiszki / Ankieta and „Co wie asystent” unchanged; one assistant card now shows the kcal target. Hidden for anonymous visitors.

**Twój cel** (P18): form rows (Płeć, Rok urodzenia, Wzrost, Aktualna waga, Waga docelowa, Aktywność na co dzień 4-segment, Tempo 3-segment + ETA), live StatStrip `1 450 podstawowa · 2 200 całkowita · 1 650 cel` (Mifflin-St Jeor), „Ustaw cel ręcznie” toggle, band add-back Segmented 0 / 50 / 100 %. Pinned „Zapisz cel”.

**Aktywność** (P19–P22): connection block (connected / stale gold block with hint + „Sprawdź ponownie” / not set up with chain, 3 steps, webhook URL + „Kopiuj”), today StatStrip (kroki · kcal aktywnych · +155 do budżetu), workouts with source tag, last 7 days list, pinned „+ Dodaj trening” → P22 sheet (type chips, minutes, kcal with estimate, when, budget effect).

## Components (new)
- **BudgetMeter** — top row: eyebrow („Zostało” / „Ponad budżet” in `--gold-text` / „W planie”) over a mono 500 number 52 px (phone) / 64 px (desktop), letter-spacing −0.04em, unit 14/16 px `--text-3`; right column (min 150/190 px) of mono 12.5 px label/value lines. Bar 12/16 px, `--surface` track, `box-shadow: inset 0 0 0 1px --rule`, scale = max(budget, eaten+planned). Segments: eaten `--text`, overflow `--gold`, planned `--hatch` at opacity .55. 1 px tick at base target; 2 px `--bg` notch at budget when over. Line below (mono 12 `--text-3`): `1 650 cel + 155 aktywność` / `= 1 805 budżet`. Protein row: eyebrow BIAŁKO, 4 px `--border` track with `--accent` fill, mono `B 74 / 110 g`.
- **DiaryItem** — grid `22px 44px minmax(0,1fr) auto` (desktop 52 px thumb), gap 12, padding 10 0, 1 px `--border` top. Eaten: 22 px `--sage` disc + white ✓, title 16 px 500 ink, kcal mono 13.5 500 ink. Planned: 22 px 1.5 px dashed `--border-2` ring, title `--text-2`, kcal `~410` `--text-3`, 36 px outline pill „✓ Zjedzone”. Meta (wrap, gap 4/10): portion `×1,5` / grams `43 g` mono 12; leftover: CookMark + italic Newsreader 14 „resztki z poniedziałku”; „brak kcal”: mono 11 `--gold-text`, 1 px `--gold` border, radius 4. Products have no thumbnail column.
- **CookMark** — 17 px circle, mono 600 9.5 px letter. Filled ink = cook day, 1 px outline = leftover portion. Letter assigned per cook within the visible week.
- **FridgeStrip** — rows: thumb, CookMark + serif 17/19, PortionDots (7 px; ink = left, `--border-2` ring = used) + mono `1 z 4 porcji · 520 kcal`, 38 px outline pill „Zjem porcję”. Leftover can also be marked „wyrzucone” (swipe / long-press menu).
- **WeekDayBar** — 4 px, track `--border` (on ink: `#4a3e32`), segment logic as BudgetMeter. Under ≤ 95 %, around 95–105 %, over > 105 %.
- **WeightChart** — SVG. Y 63–75 kg, gridlines every 2 kg (`--border`), mono labels 10/11 px `--text-3`. Dots r 2.2/2.6 `--text-3` @ .75. Trend = trailing 7-day mean of available weigh-ins, 2/2.5 px `--accent` polyline + end dot + mono value. Goal 1 px ink dashed 4 4, label „cel 64”. Legend in mono 11.5.
- **SourceTag** — mono 10.5: 6 px `--sage` dot + „z opaski” (`--sage-text`) or `--text-3` ring + „ręcznie”.
- **Sheet** — phone: radius 24 24 0 0, padding 10 20 34, 38×4 `--border-2` handle, scrim `rgba(29,24,19,.45)`, max-height ~92 %. Desktop: 480 px dialog, radius 16, padding 24 28 28, ✕ in 36 px `--border` ring. Primary action last, full width, 54 px.

## New tokens
| token | value | use |
|---|---|---|
| `--hatch` | `repeating-linear-gradient(-45deg, #1d1813 0 1px, transparent 1px 4px)` | planned kcal (on ink use `#f5f0e6` stripes) |
| `--gold-text` | `oklch(0.5 0.11 75)` | over-budget label, „brak kcal” |
| `--gold-soft` | `#f3e8cf` | stale-sync block |
| `--sage-text` | `oklch(0.47 0.09 135)` | „z opaski”, „znaleziono” |

All other values are existing tokens (`--bg #f5f0e6`, `--surface #fbf8f2`, `--seg-bg #ebe3d5`, `--border #ddd3c3`, `--border-2 #c9bca8`, `--rule/--text #1d1813`, `--text-2 #5e5448`, `--text-3 #7a6f61`, `--accent oklch(0.58 0.19 33)`, `--accent-text oklch(0.52 0.19 33)`, `--accent-soft #f6dfd5`, `--sage oklch(0.55 0.09 135)`, `--gold oklch(0.7 0.13 75)`). Type: Newsreader 500, Schibsted Grotesk, JetBrains Mono (all numbers + eyebrows 11 px / .1em / uppercase). Radii 12 (buttons/inputs), 999 (pills), 10/8 (thumbs), 24 (sheet), 16 (dialog).

## Interactions & state
- Diary entry: `{ id, date, slot, kind: recipe|product|leftover, recipeId?, cookId?, portion, grams?, kcal, protein, fat, carbs, status: planned|eaten, source }`. Eaten entries snapshot kcal/macros.
- Cook: `{ id, recipeId, date, slot, portions, kcalPerPortion }`; leftovers reference `cookId`; shopping list only counts the cook entry. Fridge = cooks with portions − assigned − eaten − discarded > 0.
- Budget(day) = target + round(activeKcal × addBack); target from profile or manual override.
- „✓ Zjedzone”: planned → eaten, keeps portion; long-press opens portion picker (0,5 / 1 / 1,5 / inna).
- Favourite chip tap logs immediately to the selected slot, shows undo toast (no confirmation sheet).
- Barcode: camera via `BarcodeDetector` (fallback lib), lookup `world.openfoodfacts.org/api/v2/product/{ean}`; not found → manual form stored under EAN.
- Activity sync: HC Webhook POST to per-user URL every 15–60 min; stale after 24 h without data.
- Anonymous: diary, weight, activity endpoints return 401; UI shows P6 placeholder; recipes and week plan stay public.

## Sample data
Her: 31 y, 168 cm, 71,2 kg → 64 kg, −0,5 kg/week, target 1 650 kcal, protein 110 g. Today Wed 14 Oct 2026: owsianka 380 ✓, gulasz (leftover A from Mon) 520 ✓, Kinder Bueno 43 g 245 ✓, latte 120 ✓, sałatka 410 planned. Band: 7 412 steps, Trening siłowy 45 min, 310 kcal → +155. Weight series is generated (74,0 → 71,2 over 8 weeks, noisy, some days missing).

## Assets
`img/01.png`–`img/10.png` — recipe photos from `mise-images` (placeholders paired loosely with recipe names). Recipes without photos use the typographic thumbnail (initials, italic Newsreader on `--seg-bg`). No icon set.

## Files
- `Pichci Dziennik.dc.html` — all new screens + component/tokens notes (section 07).
- `Pichci Mobile.dc.html`, `Pichci Desktop.dc.html` — the October 2026 redesign this builds on.
- `img/` — photos used by the mockups.
