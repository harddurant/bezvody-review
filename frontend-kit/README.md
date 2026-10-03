# Frontend-kit для Bezvody

Готовый к вставке слой доступа к данным + PWA. Интеграцию в репозиторий делаешь ты — я песочницей до приватного GitHub не достаю.

## Что внутри

- `supabaseClient.ts` — типизированный клиент Supabase.
- `api.ts` — все запросы: поиск/добавление продукта, лог еды и напитков, вода, подбор рецептов, корзина, рецепты, кладовая.
- `pwa/manifest.webmanifest`, `pwa/service-worker.js` — установка на телефон и офлайн-оболочка.
- Опирается на `../database.types.ts` (в корне проекта).

## Установка

1. Зависимость: `npm i @supabase/supabase-js`
2. Положи файлы в проект (например `src/lib/`), поправь путь импорта `database.types`.
3. Переменные окружения (Vite):
   ```
   VITE_SUPABASE_URL=https://SUPABASE_PROJECT_REF.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_REDACTED
   ```
   Для Next.js — префикс `NEXT_PUBLIC_` и `process.env` в `supabaseClient.ts`.
   Если приложение статическое без бандлера — ключ публичный, можно вписать значения прямо в `supabaseClient.ts`.

## Примеры

```ts
import { searchProducts, logProduct, suggestRecipes, generateShoppingList, addWater, getWaterProduct } from './api'

// поиск и лог еды (со снимком КБЖУ)
const found = await searchProducts('куриная грудка')
await logProduct(found[0], 150, { meal: 'lunch' })

// подбор под остаток КБЖУ: 600 ккал, 40 г белка, готовлю, ±10%
const meals = await suggestRecipes({ target_kcal: 600, target_protein: 40, can_cook: true, tolerance: 0.10 })

// «нет кухни» — только готовое
const nocook = await suggestRecipes({ target_kcal: 300, can_cook: false })

// корзина из плана
const basket = await generateShoppingList([
  { recipe_id: '…', servings: 3 },
  { recipe_id: '…', servings: 5 },
])
```

## Панель напитков

`getDrinks()` возвращает продукты с тегом `drink` (вода, кофе, чай, сок, кола, кефир, пиво).
Рендери их плитками; тап = `logProduct(drink, drink.default_serving_g ?? 250, { meal: 'drink' })`.
Твой механизм «прошлая порция» → `repeatEntry(entry)`.

## Водяной виджет (суперудобно)

```ts
const water = await getWaterProduct()          // кешируй water.id
const goal = await getWaterGoal()               // мл, дефолт 2000
let drunk = await getWaterMl(water.id)          // выпито за сегодня

// кнопки:
await addWater(250, water.id)                   // +стакан
await addWater(500, water.id)                   // +бутылка
```

Показывай кольцо/прогресс `drunk / goal`. Цель меняется `setWaterGoal(ml)`.
Вода = 0 ккал и в общий КБЖУ не мешает, но лежит в том же дневнике (единый источник).

## PWA

1. Положи `manifest.webmanifest` в корень раздачи, добавь в `<head>`:
   ```html
   <link rel="manifest" href="/manifest.webmanifest" />
   <meta name="theme-color" content="#0b0b0f" />
   ```
2. Добавь иконки `/icons/icon-192.png` и `/icons/icon-512.png`.
3. Зарегистрируй service worker:
   ```ts
   if ('serviceWorker' in navigator) {
     window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js'))
   }
   ```
4. На телефоне: «Добавить на экран» → приложение в standalone.

## Хардеринг перед продом (не блокирует разработку)

- Вернуть подтверждение email (сейчас авто-конфирм) — иначе фейки засорят общий каталог.
- Включить защиту от утёкших паролей в Auth.
- `created_by` в `products` технически читаем через базовую таблицу. Фронт читает из `products_public` (без него), но для полной приватности перед продом закрыть колонку column-grant'ом. Скажи — сделаю.
- Верификация продуктов/рецептов (`verified=true`, `official`) — только привилегированным путём (админ-скрипт / edge function), не из клиента.
