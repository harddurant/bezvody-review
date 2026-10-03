import { supabase } from './supabaseClient'
import type { Database } from '../database.types'

type ProductPublic = Database['public']['Views']['products_public']['Row']
type DiaryRow = Database['public']['Tables']['diary_entries']['Row']
type DiaryInsert = Database['public']['Tables']['diary_entries']['Insert']

const round1 = (n: number) => Math.round(n * 10) / 10
const today = () => new Date().toLocaleDateString('sv-SE') // локальная дата YYYY-MM-DD

// ---------- Каталог: поиск и добавление ----------

/** Поиск продуктов по имени. Проверенные (verified) идут выше. */
export async function searchProducts(query: string, limit = 20) {
  const { data, error } = await supabase
    .from('products_public')
    .select('*')
    .ilike('name', `%${query}%`)
    .order('verified', { ascending: false })
    .order('name')
    .limit(limit)
  if (error) throw error
  return data ?? []
}

/** Добавить продукт в общий каталог (source=community, verified=false — задаются политикой). */
export async function addProduct(p: {
  name: string
  kcal_per_100g: number
  protein_per_100g?: number
  fat_per_100g?: number
  carb_per_100g?: number
  brand?: string
  category?: string        // ВАЖНО: собирай категорию в форме — нужна для ИИ-подбора
  tags?: string[]
  default_serving_g?: number
  serving_label?: string
}) {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Требуется вход')
  const { data, error } = await supabase
    .from('products')
    .insert({ ...p, created_by: auth.user.id, source: 'community', verified: false })
    .select()
    .single()
  if (error) throw error
  return data
}

// ---------- Дневник: логирование еды и напитков ----------

/** Записать продукт в дневник со снимком КБЖУ (правка каталога не изменит историю). */
export async function logProduct(
  product: Pick<ProductPublic, 'id' | 'name' | 'kcal_per_100g' | 'protein_per_100g' | 'fat_per_100g' | 'carb_per_100g'>,
  grams: number,
  opts?: { meal?: string; date?: string },
) {
  const k = grams / 100
  const row: DiaryInsert = {
    product_id: product.id,
    product_name: product.name ?? '',            // снимок имени
    grams,
    kcal: round1((product.kcal_per_100g ?? 0) * k),
    protein: round1((product.protein_per_100g ?? 0) * k),
    fat: round1((product.fat_per_100g ?? 0) * k),
    carb: round1((product.carb_per_100g ?? 0) * k),
    meal: opts?.meal ?? null,
    entry_date: opts?.date ?? today(),
  }
  const { data, error } = await supabase.from('diary_entries').insert(row).select().single()
  if (error) throw error
  return data
}

/** Повтор прошлой записи в один тап (та же порция). */
export async function repeatEntry(entry: DiaryRow, date = today()) {
  const { id, created_at, user_id, ...rest } = entry
  const { data, error } = await supabase
    .from('diary_entries')
    .insert({ ...rest, entry_date: date })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Дневник за дату. */
export async function getDiary(date = today()) {
  const { data, error } = await supabase
    .from('diary_entries')
    .select('*')
    .eq('entry_date', date)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

/** Итог КБЖУ за день (считается на клиенте из записей). */
export function sumTotals(entries: DiaryRow[]) {
  return entries.reduce(
    (a, e) => ({
      kcal: a.kcal + Number(e.kcal),
      protein: a.protein + Number(e.protein),
      fat: a.fat + Number(e.fat),
      carb: a.carb + Number(e.carb),
    }),
    { kcal: 0, protein: 0, fat: 0, carb: 0 },
  )
}

// ---------- Напитки и вода ----------

/** Все напитки для быстрой панели (tag='drink'). */
export async function getDrinks() {
  const { data, error } = await supabase
    .from('products_public')
    .select('*')
    .contains('tags', ['drink'])
    .order('name')
  if (error) throw error
  return data ?? []
}

/** Продукт «Вода» (tag='water'). Кешируй id на клиенте. */
export async function getWaterProduct() {
  const { data, error } = await supabase
    .from('products_public')
    .select('*')
    .contains('tags', ['water'])
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Быстрое добавление воды: +250 / +500 мл. Логируется как продукт «Вода», граммы = мл. */
export async function addWater(ml: number, waterProductId: string, date = today()) {
  const { data, error } = await supabase
    .from('diary_entries')
    .insert({
      product_id: waterProductId,
      product_name: 'Вода',
      grams: ml,
      kcal: 0, protein: 0, fat: 0, carb: 0,
      meal: 'drink',
      entry_date: date,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Сколько воды выпито за день (мл). */
export async function getWaterMl(waterProductId: string, date = today()) {
  const { data, error } = await supabase
    .from('diary_entries')
    .select('grams')
    .eq('entry_date', date)
    .eq('product_id', waterProductId)
  if (error) throw error
  return (data ?? []).reduce((s, r) => s + Number(r.grams), 0)
}

/** Дневная цель по воде (мл), хранится в profiles.settings.water_goal_ml. */
export async function getWaterGoal(): Promise<number> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return 2000
  const { data } = await supabase.from('profiles').select('settings').eq('id', auth.user.id).maybeSingle()
  const s = (data?.settings as Record<string, unknown>) ?? {}
  return (s.water_goal_ml as number) ?? 2000
}

export async function setWaterGoal(ml: number) {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Требуется вход')
  const { data } = await supabase.from('profiles').select('settings').eq('id', auth.user.id).maybeSingle()
  const settings = { ...((data?.settings as Record<string, unknown>) ?? {}), water_goal_ml: ml }
  const { error } = await supabase.from('profiles').upsert({ id: auth.user.id, settings })
  if (error) throw error
}

// ---------- Движок подбора и корзина ----------

/** Подбор рецептов под остаток КБЖУ. can_cook=false → только «без готовки». */
export async function suggestRecipes(params: {
  target_kcal: number
  target_protein?: number
  can_cook?: boolean
  tolerance?: number       // доля, напр. 0.10 = ±10%
  max_results?: number
}) {
  const { data, error } = await supabase.rpc('suggest_recipes', params)
  if (error) throw error
  return data ?? []
}

export type PlanEntry = { recipe_id: string; servings: number }

/** Корзина из плана: потребность → минус кладовая → округление до упаковок. */
export async function generateShoppingList(plan: PlanEntry[]) {
  const { data, error } = await supabase.rpc('generate_shopping_list', { p_plan: plan })
  if (error) throw error
  return data ?? []
}

// ---------- Рецепты ----------

export async function getRecipes() {
  const { data, error } = await supabase.from('recipes').select('*').order('category').order('name')
  if (error) throw error
  return data ?? []
}

/** Суммарные КБЖУ рецепта (делить на servings для порции). */
export async function getRecipeMacros(recipeId: string) {
  const { data, error } = await supabase.from('recipe_macros').select('*').eq('recipe_id', recipeId).maybeSingle()
  if (error) throw error
  return data
}

export async function getRecipeIngredients(recipeId: string) {
  const { data, error } = await supabase
    .from('recipe_ingredients')
    .select('grams, note, sort_order, product:products(name, kcal_per_100g, protein_per_100g, fat_per_100g, carb_per_100g, serving_label)')
    .eq('recipe_id', recipeId)
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

// ---------- Кладовая ----------

export async function getPantry() {
  const { data, error } = await supabase
    .from('pantry_items')
    .select('product_id, note, product:products(name, category)')
  if (error) throw error
  return data ?? []
}

export async function addToPantry(productId: string, note?: string) {
  const { data, error } = await supabase.from('pantry_items').insert({ product_id: productId, note }).select().single()
  if (error) throw error
  return data
}

export async function removeFromPantry(productId: string) {
  const { error } = await supabase.from('pantry_items').delete().eq('product_id', productId)
  if (error) throw error
}

// ---------- Качество, альтернативы, план на день ----------

/** Нейтральная метрика качества продукта (плотность, ярлык — без «плохо»). */
export async function getProductQuality(productId: string) {
  const { data, error } = await supabase.from('product_quality').select('*').eq('id', productId).maybeSingle()
  if (error) throw error
  return data
}

/** Советник альтернатив: чем заменить продукт (легче/белковее в той же категории). */
export async function suggestAlternatives(productId: string, maxResults = 5) {
  const { data, error } = await supabase.rpc('suggest_alternatives', { p_product_id: productId, max_results: maxResults })
  if (error) throw error
  return data ?? []
}

/** План на день: N приёмов под дневную цель КБЖУ (жадный подбор без повторов). */
export async function suggestDay(params: {
  target_kcal: number
  target_protein?: number
  can_cook?: boolean
  meals?: number
  tolerance?: number
}) {
  const { data, error } = await supabase.rpc('suggest_day', params)
  if (error) throw error
  return data ?? []
}

/** Записать рецепт в дневник в один тап (снимок КБЖУ на N порций). Замыкает предложение → лог. */
export async function logRecipe(recipeId: string, servings = 1, opts?: { meal?: string; date?: string }) {
  const { data, error } = await supabase.rpc('log_recipe', {
    p_recipe_id: recipeId,
    p_servings: servings,
    p_meal: opts?.meal,
    p_date: opts?.date,
  })
  if (error) throw error
  return data
}

// ---------- Онбординг: расчёт целей и нечёткий поиск ----------

/** Дневные цели КБЖУ из антропометрии (Mifflin-St Jeor). Сохрани результат в profiles.goal_*. */
export async function calculateTargets(p: {
  weight_kg: number
  height_cm: number
  age: number
  sex: string          // 'male' | 'female'
  activity?: string    // sedentary|light|moderate|active|very_active
  goal?: string        // lose|maintain|gain|recomp
}) {
  const { data, error } = await supabase.rpc('calculate_targets', p)
  if (error) throw error
  return data?.[0] ?? null
}

/** Нечёткий поиск продуктов (триграммы + опечатки). Лучше для матчинга, чем searchProducts. */
export async function searchProductsFuzzy(query: string, maxResults = 20) {
  const { data, error } = await supabase.rpc('search_products_fuzzy', { q: query, max_results: maxResults })
  if (error) throw error
  return data ?? []
}
