import { createClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'

// Vite: значения из .env (VITE_*). Для Next.js замени на process.env.NEXT_PUBLIC_*.
// Ключ publishable/anon — публичный, его безопасно держать на клиенте.
const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient<Database>(url, key)
