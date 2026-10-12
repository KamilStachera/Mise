// ---- API types (mirror the backend DTOs) ----
export type Source = 'ai' | 'web' | 'manual'
export type Status = 'in' | 'low' | 'out' | 'unknown'
export type Unit = 'g' | 'ml' | 'szt'
export type StockConfidence = 'confirmed' | 'estimated' | 'stale'
export type DishType = 'breakfast' | 'main' | 'soup' | 'salad' | 'side' | 'dessert' | 'snack' | 'baking'
export type Cuisine =
  | 'polish' | 'italian' | 'french' | 'spanish' | 'greek' | 'mediterranean' | 'middleeastern'
  | 'indian' | 'thai' | 'vietnamese' | 'chinese' | 'japanese' | 'korean' | 'mexican' | 'american' | 'other'

export interface RecipeListItem {
  id: string
  title: string
  source: Source
  time: number
  servings: number
  difficulty: string
  tint: string
  blurb: string
  imageUrl: string | null
  toBuyCount: number
  dishType: DishType | null
  cuisine: Cuisine | null
  usesAirFryer: boolean
  createdAt: string
  /** Estimated nutrition per serving; null = not yet estimated. */
  kcal: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
  /** Free-text origin (book, site, diet plan) — the card eyebrow; null = just the source bucket. */
  sourceName: string | null
}

export interface Ingredient {
  name: string
  quantity: string
  displayText: string | null
  alternativeGroup: string | null
  status: Status
}

/** One gallery photo; the default one is shown on cards and the hero. */
export interface RecipeImage {
  id: string
  url: string
  isDefault: boolean
  createdAt: string
}

export interface RecipeDetail {
  id: string
  title: string
  source: Source
  time: number
  servings: number
  /** Saved portion choice (defaults to servings); ingredient amounts arrive already scaled to it. */
  selectedServings: number
  difficulty: string
  tint: string
  blurb: string
  imageUrl: string | null
  images: RecipeImage[]
  tip: string | null
  ingredients: Ingredient[]
  steps: string[]
  have: number
  total: number
  missing: string[]
  dishType: DishType | null
  cuisine: Cuisine | null
  usesAirFryer: boolean
  /** Estimated nutrition per serving; null = not yet estimated. */
  kcal: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
  /** Free-text origin (book, site, diet plan) — the card eyebrow; null = just the source bucket. */
  sourceName: string | null
}

export interface PantryItem {
  id: string
  name: string
  category: string
  unit: Unit
  quantity: number
  planningQuantity: number
  confidence: StockConfidence
  reliabilityUpdatedAt: string | null
  lowThreshold: number | null
  /** Derived from quantity: 0 = out, below threshold = low. */
  status: Status
  aliases: string[]
}
export interface PantryGroup {
  category: string
  items: PantryItem[]
}
export interface PantryItemInput {
  name: string
  category: string
  unit: Unit
  quantity?: number
  lowThreshold?: number | null
  aliases?: string[]
}

export interface ShoppingItem {
  id: string
  name: string
  category: string
  reason: string
  checked: boolean
  origin: string
  quantity: number | null
  unit: Unit | null
  /** Recipes this row is for (from recipe buttons or the plan); empty for manual rows. */
  recipes: ShoppingRecipeRef[]
}
export interface ShoppingRecipeRef {
  id: string
  title: string
  imageUrl: string | null
}
export interface ShoppingList {
  items: ShoppingItem[]
  total: number
  checkedCount: number
}

export type SupplyCategory = 'cleaning' | 'hygiene' | 'paper' | 'kitchen' | 'pets' | 'other'

/** A household item to buy. Name-only by design — no quantity, no pantry link. */
export interface SupplyItem {
  id: string
  name: string
  category: SupplyCategory
  checked: boolean
}
/** A learned frequent item, ranked server-side; `id` addresses the tally, not a list row. */
export interface HotSupply {
  id: string
  name: string
  category: SupplyCategory
  count: number
  pinned: boolean
  hidden: boolean
}
export interface SupplyList {
  items: SupplyItem[]
  total: number
  checkedCount: number
  hot: HotSupply[]
}

/** One row of the "Ugotowane!" confirm dialog — what would be deducted and why not. */
export interface CookProposalItem {
  ingredientId: string
  name: string
  quantityText: string
  displayText: string | null
  alternativeGroup: string | null
  pantryItemId: string | null
  pantryItemName: string | null
  unit: Unit | null
  pantryQuantity: number | null
  proposedAmount: number | null
  deductible: boolean
  skipReason: 'unlinked' | 'unparsed' | 'unit-mismatch' | 'alternative-not-selected' | null
}
export interface CookProposal {
  recipeId: string
  title: string
  items: CookProposalItem[]
}

export interface Equipment {
  name: string
  favorite: boolean
}
export interface Preferences {
  householdSummary: string
  householdDetail: string
  skillSummary: string
  skillDetail: string
  tasteCuisines: string
  avoidDietary: string
  equipmentNote: string
  equipment: Equipment[]
}

export interface ChatHealth {
  enabled: boolean
  provider: string
}
export interface ChatMessage {
  id: string
  role: 'ai' | 'user'
  content: string
  createdAt: string
}

export interface RecipeInput {
  title: string
  source: Source
  sourceName?: string | null
  time: number
  servings: number
  difficulty?: string
  tint?: string
  blurb?: string
  tip?: string
  ingredients: {
    name: string
    quantity?: string
    displayText?: string
    alternativeGroup?: string
    amountValue?: number
    amountUnit?: Unit
  }[]
  steps: string[]
  dishType?: DishType
  cuisine?: Cuisine
  /** Omitted = the backend guesses from the recipe text. */
  usesAirFryer?: boolean
  /** Estimated nutrition per serving; omitted on PUT clears the stored values. */
  kcal?: number
  protein?: number
  fat?: number
  carbs?: number
}

export interface CookLogEntry {
  id: string
  recipeId: string | null
  dishName: string
  rating: number | null
  note: string
  cookedAt: string // YYYY-MM-DD
}
export interface CookDeduction {
  pantryItemId: string
  amount: number
}
export interface CookLogInput {
  recipeId?: string
  dishName?: string
  rating?: number
  note?: string
  cookedAt?: string
  deductions?: CookDeduction[]
}
/** rating/note are full-replace (omitted = cleared); dishName/cookedAt keep the stored value when omitted. */
export interface CookLogUpdateInput {
  dishName?: string
  rating?: number | null
  note?: string
  cookedAt?: string
}
export interface CookLogResult {
  entry: CookLogEntry
  deducted: { pantryItemId: string; name: string; deducted: number; newQuantity: number; status: Status }[]
}

export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export interface PlanEntry {
  id: string
  date: string // YYYY-MM-DD
  slot: Slot
  recipeId: string | null
  recipeTitle: string | null
  title: string
  note: string
  /** A matching cook-log entry exists (same recipe/dish, ±1 day; leftovers use their cook day). */
  cooked: boolean
  /** Portions of the recipe (×0,5…); 1 for products. */
  portions: number
  /** Grams eaten, for products logged per 100 g. */
  grams: number | null
  /** Nutrition TOTALS for this entry (eaten snapshot, typed values, or live estimate × portions). */
  kcal: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
  /** Nothing to count — "brak kcal". */
  kcalMissing: boolean
  /** Always false for anonymous visitors (the diary is private). */
  eaten: boolean
  /** The pot this entry belongs to (cook day or leftover). */
  cookId: string | null
  isLeftover: boolean
  cookDate: string | null
  cookPortions: number | null
  /** The day's catering box (counted as eaten automatically on delivery days). */
  isCatering: boolean
}
/** A pot with portions left in the fridge. */
export interface FridgeItem {
  cookId: string
  recipeId: string | null
  title: string
  date: string
  portions: number
  remaining: number
  kcalPerPortion: number | null
}
export interface Cook {
  id: string
  recipeId: string | null
  title: string
  date: string
  portions: number
  discardedPortions: number
  remaining: number
  kcalPerPortion: number | null
  entries: PlanEntry[]
}
export interface CookAssignment {
  date: string
  slot: Slot
}
export interface CookInput {
  recipeId: string
  portions: number
  firstDate: string
  firstSlot: Slot
  assignments: CookAssignment[]
  /** Turn this existing planned entry into the cook day. */
  fromEntryId?: string
}
/** kcal is per portion, or per 100 g when per100g; chipKcal = what one tap logs. */
export interface FoodFavorite {
  id: string
  name: string
  kcal: number
  protein: number | null
  fat: number | null
  carbs: number | null
  per100g: boolean
  lastGrams: number | null
  barcode: string | null
  chipKcal: number
  count: number
  pinned: boolean
  hidden: boolean
}
export interface FoodFavoriteInput {
  name: string
  kcal: number
  protein?: number | null
  fat?: number | null
  carbs?: number | null
  per100g?: boolean
  lastGrams?: number | null
  barcode?: string | null
}
/** Always adds. Typed nutrition (kcal…) is the entry TOTAL. */
export interface DiaryEntryInput {
  date: string
  slot: Slot
  recipeId?: string | null
  title?: string
  note?: string
  portions?: number
  grams?: number | null
  kcal?: number | null
  protein?: number | null
  fat?: number | null
  carbs?: number | null
  eaten?: boolean
  favorite?: FoodFavoriteInput
}
export type BodySex = 'female' | 'male'
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'high'
/** „Twój cel”. configured=false → not set up yet. target = override ?? computed. */
export interface Body {
  configured: boolean
  sex: BodySex
  birthYear: number
  heightCm: number
  goalKg: number
  activityLevel: ActivityLevel
  paceKg: number
  targetOverride: number | null
  proteinOverride: number | null
  addBackPercent: number
  currentKg: number | null
  bmr: number | null
  tdee: number | null
  computedTarget: number | null
  target: number | null
  proteinTarget: number | null
}
export interface BodyInput {
  sex: BodySex
  birthYear: number
  heightCm: number
  goalKg: number
  activityLevel: ActivityLevel
  paceKg: number
  targetOverride?: number | null
  proteinOverride?: number | null
  addBackPercent: number
  currentKg?: number | null
}
export interface DayBudget {
  date: string
  target: number
  activeKcal: number
  bonus: number
  budget: number
}
/** target null = no profile yet (days empty). */
export interface BudgetRange {
  target: number | null
  proteinTarget: number | null
  addBackPercent: number
  days: DayBudget[]
}
export interface WeightPoint {
  date: string
  kg: number
  trend: number
  source: 'manual' | 'healthconnect'
}
export interface WeekSummary {
  from: string
  to: string
  daysLogged: number
  avgEaten: number
  avgBudget: number
  deficit: number
  estLossKg: number
}
export interface Progress {
  configured: boolean
  goalKg: number | null
  currentKg: number | null
  trendKg: number | null
  weeklyChange: number | null
  sinceStart: number | null
  etaWeeks: number | null
  weights: WeightPoint[]
  week: WeekSummary | null
  streak: number
}

/** Scanned product. Nutrition per 100 g. source: 'favorite' = remembered by her, 'openfoodfacts', 'none'. */
export interface BarcodeProduct {
  barcode: string
  found: boolean
  source: 'favorite' | 'openfoodfacts' | 'none'
  name: string | null
  brand: string | null
  kcalPer100g: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
  servingGrams: number | null
  servingLabel: string | null
  lastGrams: number | null
}

export type SyncState = 'none' | 'connected' | 'stale'
export interface Workout {
  id: string
  date: string
  startedAt: string | null
  minutes: number
  /** Band workouts: derived from the band's active kcal in that window; null until synced. */
  kcal: number | null
  type: string
  source: 'band' | 'manual'
}
export interface ActivityDay {
  date: string
  activeKcal: number
  bonus: number
  workouts: Workout[]
}
/** days newest first. */
export interface Activity {
  state: SyncState
  lastSyncAt: string | null
  addBackPercent: number
  days: ActivityDay[]
}
/** Diet catering: the average box day. weekdays = bitmask, bit 0 = Monday … bit 6 = Sunday. */
export interface Catering {
  configured: boolean
  enabled: boolean
  kcal: number
  protein: number | null
  fat: number | null
  carbs: number | null
  weekdays: number
  startDate: string | null
}
export interface CateringInput {
  enabled: boolean
  kcal: number
  protein?: number | null
  fat?: number | null
  carbs?: number | null
  weekdays: number
  startDate?: string
}
export interface HealthConnection {
  token: string
  state: SyncState
  lastSyncAt: string | null
}
export interface WorkoutInput {
  date: string
  type: string
  minutes: number
  kcal: number
  /** "HH:mm" */
  time?: string
}

/** Only present fields change. */
export interface PlanEntryPatch {
  date?: string
  slot?: Slot
  portions?: number
  grams?: number | null
  kcal?: number
  protein?: number
  fat?: number
  carbs?: number
  eaten?: boolean
  note?: string
  title?: string
}
export interface PlanRange {
  start: string
  days: number
  entries: PlanEntry[]
}
export interface PlanEntryInput {
  date: string
  slot: Slot
  recipeId?: string | null
  title?: string
  note?: string
}

export interface ShoppingPreviewItem {
  key: string
  pantryItemId: string | null
  name: string
  requiredQuantity: number | null
  unit: Unit | null
  estimatedQuantity: number | null
  planningQuantity: number | null
  estimatedPurchase: number | null
  suggestedPurchase: number | null
  confidence: StockConfidence | 'unknown'
  needsConfirmation: boolean
  sources: string[]
  alternativePantryItemIds: string[] | null
}
export interface ShoppingPreview {
  start: string
  days: number
  items: ShoppingPreviewItem[]
}
export interface PantryConfirmation {
  pantryItemId: string
  quantity: number
}

export interface Question {
  key: string
  label: string
  type: 'text' | 'longtext' | 'choice' | 'scale'
  options: string[] | null
  placeholder: string | null
}
export interface QuestionnaireSection {
  key: string
  title: string
  questions: Question[]
}
export interface Questionnaire {
  sections: QuestionnaireSection[]
  answers: Record<string, string>
}

export interface ConnectInfo {
  apiBase: string
  contextPath: string
  hostContextPath: string | null
  prompts: {
    oneShot: string
    globalSnippet: string
    commandsInstall: string
    claudeMcpCommand: string
    codexMcpToml: string
  }
}

export interface Person {
  id: number
  name: string
}
export interface AuthMe {
  authenticated: boolean
  email: string | null
  name: string | null
  picture: string | null
  /** The caller's own diary. */
  personId: number | null
  /** Everyone with a diary; empty for anonymous visitors. */
  people: Person[] | null
}

// ---- fetch helpers ----
const BASE = '/api'

/** Carries the HTTP status so callers can react to 401 (session expired / read-only). */
export class ApiError extends Error {
  status: number
  constructor(status: number, statusText: string) {
    super(`${status} ${statusText}`)
    this.status = status
  }
}

/** Whose diary the private endpoints act for (the Plan switcher); null = the caller's own. */
let personHeader: number | null = null
export function setPersonHeader(id: number | null) {
  personHeader = id
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (personHeader != null) headers['X-Person'] = String(personHeader)
  const res = await fetch(BASE + path, { headers, ...init })
  if (!res.ok) throw new ApiError(res.status, res.statusText)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  recipes: (source?: string, q?: string) => {
    const p = new URLSearchParams()
    if (source && source !== 'all') p.set('source', source)
    if (q) p.set('q', q)
    const qs = p.toString()
    return http<RecipeListItem[]>(`/recipes${qs ? '?' + qs : ''}`)
  },
  recipe: (id: string) => http<RecipeDetail>(`/recipes/${id}`),
  createRecipe: (input: RecipeInput) =>
    http<{ id: string }>(`/recipes`, { method: 'POST', body: JSON.stringify(input) }),
  deleteRecipe: (id: string) => http<void>(`/recipes/${id}`, { method: 'DELETE' }),
  setRecipeServings: (id: string, servings: number) =>
    http<{ servings: number; selectedServings: number }>(`/recipes/${id}/servings`, {
      method: 'PUT',
      body: JSON.stringify({ servings }),
    }),
  addMissingToShopping: (id: string) =>
    http<{ added: number; updated: number }>(`/recipes/${id}/add-missing-to-shopping`, { method: 'POST' }),
  // Multipart — bypasses the JSON `http` helper so the browser sets the boundary header.
  uploadRecipeImage: async (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/recipes/${id}/image`, { method: 'POST', body: form })
    if (!res.ok) throw new ApiError(res.status, res.statusText)
    return (await res.json()) as { imageId: string; imageUrl: string; images: RecipeImage[] }
  },
  deleteRecipeImage: (id: string, imageId: string) =>
    http<{ images: RecipeImage[] }>(`/recipes/${id}/images/${imageId}`, { method: 'DELETE' }),
  setDefaultRecipeImage: (id: string, imageId: string) =>
    http<{ images: RecipeImage[] }>(`/recipes/${id}/images/${imageId}/default`, { method: 'PUT' }),

  pantry: () => http<PantryGroup[]>(`/pantry`),
  setPantryQuantity: (id: string, quantity: number) =>
    http<PantryItem>(`/pantry/${id}/quantity`, { method: 'PATCH', body: JSON.stringify({ quantity }) }),
  updatePantry: (id: string, input: PantryItemInput) =>
    http<PantryItem>(`/pantry/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  addPantry: (input: PantryItemInput) =>
    http<PantryItem>(`/pantry`, { method: 'POST', body: JSON.stringify(input) }),
  deletePantry: (id: string) => http<void>(`/pantry/${id}`, { method: 'DELETE' }),

  shopping: () => http<ShoppingList>(`/shopping`),
  checkShopping: (id: string) => http<ShoppingItem>(`/shopping/${id}/check`, { method: 'PATCH' }),
  addShopping: (name: string, category?: string) =>
    http<ShoppingItem>(`/shopping`, { method: 'POST', body: JSON.stringify({ name, category }) }),
  deleteShopping: (id: string) => http<void>(`/shopping/${id}`, { method: 'DELETE' }),
  clearChecked: () => http<{ removed: number }>(`/shopping/clear-checked`, { method: 'POST' }),
  clearShopping: () => http<{ removed: number }>(`/shopping/clear`, { method: 'POST' }),

  supplies: () => http<SupplyList>(`/supplies`),
  /** Every learned entry, hidden included — for the manage panel. */
  allHotSupplies: () => http<HotSupply[]>(`/supplies/hot?all=true`),
  addSupply: (name: string, category?: SupplyCategory) =>
    http<SupplyItem>(`/supplies`, { method: 'POST', body: JSON.stringify({ name, category }) }),
  checkSupply: (id: string) => http<SupplyItem>(`/supplies/${id}/check`, { method: 'PATCH' }),
  deleteSupply: (id: string) => http<void>(`/supplies/${id}`, { method: 'DELETE' }),
  clearCheckedSupplies: () =>
    http<{ removed: number }>(`/supplies/clear-checked`, { method: 'POST' }),
  clearSupplies: () => http<{ removed: number }>(`/supplies/clear`, { method: 'POST' }),
  updateHotSupply: (id: string, patch: { pinned?: boolean; hidden?: boolean }) =>
    http<HotSupply>(`/supplies/hot/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  forgetHotSupply: (id: string) => http<void>(`/supplies/hot/${id}`, { method: 'DELETE' }),

  preferences: () => http<Preferences>(`/preferences`),
  savePreferences: (p: Preferences) =>
    http<Preferences>(`/preferences`, { method: 'PUT', body: JSON.stringify(p) }),

  questionnaire: () => http<Questionnaire>(`/profile/questionnaire`),
  saveAnswers: (answers: Record<string, string>) =>
    http<{ answers: Record<string, string> }>(`/profile/answers`, { method: 'PUT', body: JSON.stringify({ answers }) }),

  cookProposal: (id: string) => http<CookProposal>(`/recipes/${id}/cook-proposal`),

  cookLog: (recipeId?: string, limit?: number) => {
    const p = new URLSearchParams()
    if (recipeId) p.set('recipeId', recipeId)
    if (limit) p.set('limit', String(limit))
    const qs = p.toString()
    return http<CookLogEntry[]>(`/cooklog${qs ? '?' + qs : ''}`)
  },
  addCookLog: (input: CookLogInput) =>
    http<CookLogResult>(`/cooklog`, { method: 'POST', body: JSON.stringify(input) }),
  updateCookLog: (id: string, input: CookLogUpdateInput) =>
    http<CookLogEntry>(`/cooklog/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteCookLog: (id: string) => http<void>(`/cooklog/${id}`, { method: 'DELETE' }),

  plan: (start?: string, days?: number) => {
    const p = new URLSearchParams()
    if (start) p.set('start', start)
    if (days) p.set('days', String(days))
    const qs = p.toString()
    return http<PlanRange>(`/plan${qs ? '?' + qs : ''}`)
  },
  setPlanEntry: (input: PlanEntryInput) =>
    http<PlanEntry>(`/plan/entry`, { method: 'PUT', body: JSON.stringify(input) }),
  pendingCook: () => http<PlanEntry[]>(`/plan/pending-cook`),
  dismissCookReminder: (id: string) =>
    http<void>(`/plan/entry/${id}/dismiss-cook-reminder`, { method: 'POST' }),
  deletePlanEntry: (id: string) => http<void>(`/plan/entry/${id}`, { method: 'DELETE' }),
  planShoppingPreview: (start: string, days: number) =>
    http<ShoppingPreview>(`/plan/shopping-preview?start=${encodeURIComponent(start)}&days=${days}`),
  planAddMissing: (start: string, days: number, confirmations?: PantryConfirmation[]) =>
    http<{ added: number; updated: number }>(`/plan/add-missing-to-shopping`, {
      method: 'POST', body: JSON.stringify({ start, days, confirmations }),
    }),
  addDiaryEntry: (input: DiaryEntryInput) =>
    http<PlanEntry>(`/plan/entries`, { method: 'POST', body: JSON.stringify(input) }),
  patchPlanEntry: (id: string, input: PlanEntryPatch) =>
    http<PlanEntry>(`/plan/entry/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),

  fridge: (today: string) => http<FridgeItem[]>(`/diary/fridge?today=${today}`),
  cook: (id: string) => http<Cook>(`/diary/cooks/${id}`),
  createCook: (input: CookInput) =>
    http<Cook>(`/diary/cooks`, { method: 'POST', body: JSON.stringify(input) }),
  updateCook: (id: string, portions: number, assignments: CookAssignment[]) =>
    http<Cook>(`/diary/cooks/${id}`, { method: 'PUT', body: JSON.stringify({ portions, assignments }) }),
  eatFromCook: (id: string, date: string, slot: Slot) =>
    http<PlanEntry>(`/diary/cooks/${id}/eat`, { method: 'POST', body: JSON.stringify({ date, slot }) }),
  discardCook: (id: string) => http<void>(`/diary/cooks/${id}/discard`, { method: 'POST' }),
  foodFavorites: () => http<FoodFavorite[]>(`/diary/favorites`),
  logFavorite: (id: string, date: string, slot: Slot, grams?: number) =>
    http<PlanEntry>(`/diary/favorites/${id}/log`, { method: 'POST', body: JSON.stringify({ date, slot, grams }) }),
  barcode: (code: string) => http<BarcodeProduct>(`/diary/barcode/${encodeURIComponent(code)}`),
  activity: (days: number) => http<Activity>(`/activity?days=${days}`),
  healthConnection: () => http<HealthConnection>(`/activity/connection`),
  rotateHealthConnection: () => http<HealthConnection>(`/activity/connection/rotate`, { method: 'POST' }),
  addWorkout: (input: WorkoutInput) => http<Workout>(`/activity/workouts`, { method: 'POST', body: JSON.stringify(input) }),
  deleteWorkout: (id: string) => http<void>(`/activity/workouts/${id}`, { method: 'DELETE' }),
  body: () => http<Body>(`/body`),
  saveBody: (input: BodyInput) => http<Body>(`/body`, { method: 'PUT', body: JSON.stringify(input) }),
  budget: (start: string, days: number) => http<BudgetRange>(`/body/budget?start=${start}&days=${days}`),
  progress: (days: number) => http<Progress>(`/body/progress?days=${days}`),
  setWeight: (date: string, kg: number) =>
    http<{ date: string; kg: number }>(`/body/weights/${date}`, { method: 'PUT', body: JSON.stringify({ kg }) }),
  deleteWeight: (date: string) => http<void>(`/body/weights/${date}`, { method: 'DELETE' }),
  catering: () => http<Catering>(`/body/catering`),
  saveCatering: (input: CateringInput) =>
    http<Catering>(`/body/catering`, { method: 'PUT', body: JSON.stringify(input) }),
  logCatering: (date: string) =>
    http<PlanEntry>(`/body/catering/log`, { method: 'POST', body: JSON.stringify({ date }) }),
  setFavoriteFlags: (id: string, flags: { pinned?: boolean; hidden?: boolean }) =>
    http<FoodFavorite>(`/diary/favorites/${id}`, { method: 'PATCH', body: JSON.stringify(flags) }),

  cookbook: () => http<{ markdown: string }>(`/context/cookbook`),
  contextStatus: () => http<{ path: string; hostPath: string | null }>(`/context/status`),
  connectInfo: () => http<ConnectInfo>(`/context/connect`),
  exportContext: () =>
    http<{ path: string; files: string[]; exportedAt: string }>(`/context/export`, { method: 'POST' }),

  chatHealth: () => http<ChatHealth>(`/chat/health`),
  chatHistory: () => http<ChatMessage[]>(`/chat/history`),

  authMe: () => http<AuthMe>(`/auth/me`),
  logout: () => http<void>(`/auth/logout`, { method: 'POST' }),
}

/** Full-page navigation into the Google OAuth flow; comes back to `returnUrl`. */
export function loginUrl(returnUrl: string): string {
  return `${BASE}/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`
}

// ---- chat SSE streaming ----
export async function streamChat(
  message: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  /** Recipe the user is looking at — the server adds it to the prompt. */
  recipeId?: string,
): Promise<void> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, recipeId }),
    signal,
  })
  if (!res.ok || !res.body) throw new ApiError(res.status, res.statusText || 'chat')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      try {
        const payload = JSON.parse(line.slice('data:'.length).trim())
        if (payload.delta) onDelta(payload.delta as string)
        if (payload.error) throw new Error('stream interrupted')
      } catch (e) {
        if (e instanceof Error && e.message === 'stream interrupted') throw e
        /* ignore malformed frames */
      }
    }
  }
}
