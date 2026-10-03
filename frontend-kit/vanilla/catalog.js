/* ─────────────────────────────────────────────────────────────
   Bezvody — слой доступа к ОБЩЕМУ каталогу (ваниль, под твой sbFetch)

   Что это: тонкая обёртка над серверными таблицами/функциями каталога.
   НЕ трогает зашифрованный vault — только общие данные и RPC.
   Использует уже существующие в index.html: sbFetch(), sbTok, sbUid.

   Как встроить: вставить этот блок в <script> index.html ПОСЛЕ определения
   sbFetch. Функции требуют, чтобы пользователь был залогинен (sbTok задан) —
   каталог и RPC доступны только роли authenticated.

   Мост с локальным логом: catScale() считает КБЖУ на порцию, дальше
   результат кладёшь в свой локальный store 'log' как обычно. Т.е. каталог
   на сервере, а сам дневник пока остаётся в vault (это меняется в Фазе D).
   ───────────────────────────────────────────────────────────── */

/* Поиск продуктов: нечёткий (триграммы + опечатки). Вернёт массив. */
async function catSearch(q, limit = 20){
  const r = await sbFetch('/rest/v1/rpc/search_products_fuzzy', {
    method:'POST', body: JSON.stringify({ q, max_results: limit }) });
  if(!r.ok) throw new Error('Поиск каталога: '+r.status);
  return r.json();
}

/* Добавить продукт в общий каталог (виден всем — фича «Биг Тейсти»).
   p: {name, kcal_per_100g, protein_per_100g?, fat_per_100g?, carb_per_100g?,
       brand?, category?, tags?, default_serving_g?, serving_label?} */
async function catAdd(p){
  if(!sbUid) throw new Error('Нужен вход');
  const r = await sbFetch('/rest/v1/products', {
    method:'POST',
    headers:{ 'Prefer':'return=representation' },
    body: JSON.stringify({ ...p, created_by: sbUid, source:'community', verified:false }) });
  if(!r.ok) throw new Error('Добавление продукта: '+r.status);
  return (await r.json())[0];
}

/* Подбор рецептов под остаток КБЖУ. can_cook:false → только «без готовки».
   params: {target_kcal, target_protein?, can_cook?, tolerance?, max_results?} */
async function catSuggestRecipes(params){
  const r = await sbFetch('/rest/v1/rpc/suggest_recipes', {
    method:'POST', body: JSON.stringify(params) });
  if(!r.ok) throw new Error('Подбор рецептов: '+r.status);
  return r.json();
}

/* План на день: N приёмов под дневную цель.
   params: {target_kcal, target_protein?, can_cook?, meals?, tolerance?} */
async function catSuggestDay(params){
  const r = await sbFetch('/rest/v1/rpc/suggest_day', {
    method:'POST', body: JSON.stringify(params) });
  if(!r.ok) throw new Error('План дня: '+r.status);
  return r.json();
}

/* Корзина из плана: plan = [{recipe_id, servings}, ...] */
async function catShoppingList(plan){
  const r = await sbFetch('/rest/v1/rpc/generate_shopping_list', {
    method:'POST', body: JSON.stringify({ p_plan: plan }) });
  if(!r.ok) throw new Error('Корзина: '+r.status);
  return r.json();
}

/* Советник альтернатив: чем заменить продукт (легче/белковее). */
async function catAlternatives(productId, limit = 5){
  const r = await sbFetch('/rest/v1/rpc/suggest_alternatives', {
    method:'POST', body: JSON.stringify({ p_product_id: productId, max_results: limit }) });
  if(!r.ok) throw new Error('Альтернативы: '+r.status);
  return r.json();
}

/* Дневные цели КБЖУ из антропометрии (Mifflin-St Jeor). Вернёт один объект.
   o: {weight_kg, height_cm, age, sex, activity?, goal?} */
async function catTargets(o){
  const r = await sbFetch('/rest/v1/rpc/calculate_targets', {
    method:'POST', body: JSON.stringify(o) });
  if(!r.ok) throw new Error('Расчёт целей: '+r.status);
  return (await r.json())[0];
}

/* Рецепт с ингредиентами и суммарными КБЖУ (на порцию делить на servings). */
async function catRecipe(id){
  const [rec, mac, ing] = await Promise.all([
    sbFetch('/rest/v1/recipes?id=eq.'+id+'&select=*').then(r=>r.json()),
    sbFetch('/rest/v1/recipe_macros?recipe_id=eq.'+id+'&select=*').then(r=>r.json()),
    sbFetch('/rest/v1/recipe_ingredients?recipe_id=eq.'+id+
            '&select=grams,note,sort_order,product:products(name)&order=sort_order').then(r=>r.json()),
  ]);
  return { recipe: rec[0], macros: mac[0], ingredients: ing };
}

/* Мост с локальным дневником: КБЖУ продукта на нужную граммовку.
   Результат кладёшь в свой store 'log' как обычную запись. */
function catScale(prod, grams){
  const k = grams/100;
  return {
    grams,
    kcal:    Math.round((prod.kcal_per_100g||0)*k),
    protein: +(((prod.protein_per_100g||0)*k).toFixed(1)),
    fat:     +(((prod.fat_per_100g||0)*k).toFixed(1)),
    carb:    +(((prod.carb_per_100g||0)*k).toFixed(1)),
  };
}
