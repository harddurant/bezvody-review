export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      body_metrics: {
        Row: {
          created_at: string
          id: string
          measurements: Json | null
          metric_date: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          measurements?: Json | null
          metric_date?: string
          user_id?: string
          weight_kg?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          measurements?: Json | null
          metric_date?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
      diary_entries: {
        Row: {
          carb: number
          created_at: string
          entry_date: string
          fat: number
          grams: number
          id: string
          kcal: number
          meal: string | null
          product_id: string | null
          product_name: string
          protein: number
          user_id: string
        }
        Insert: {
          carb?: number
          created_at?: string
          entry_date?: string
          fat?: number
          grams: number
          id?: string
          kcal: number
          meal?: string | null
          product_id?: string | null
          product_name: string
          protein?: number
          user_id?: string
        }
        Update: {
          carb?: number
          created_at?: string
          entry_date?: string
          fat?: number
          grams?: number
          id?: string
          kcal?: number
          meal?: string | null
          product_id?: string | null
          product_name?: string
          protein?: number
          user_id?: string
        }
        Relationships: []
      }
      pantry_items: {
        Row: {
          created_at: string
          id: string
          note: string | null
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          product_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          product_id?: string
          user_id?: string
        }
        Relationships: []
      }
      product_packages: {
        Row: {
          amount_g: number
          created_at: string
          id: string
          is_default: boolean
          label: string
          price: number | null
          product_id: string
        }
        Insert: {
          amount_g: number
          created_at?: string
          id?: string
          is_default?: boolean
          label: string
          price?: number | null
          product_id: string
        }
        Update: {
          amount_g?: number
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          price?: number | null
          product_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          brand: string | null
          carb_per_100g: number
          category: string | null
          created_at: string
          created_by: string | null
          default_serving_g: number | null
          fat_per_100g: number
          id: string
          kcal_per_100g: number
          name: string
          name_normalized: string | null
          protein_per_100g: number
          serving_label: string | null
          source: string
          tags: string[]
          updated_at: string
          verified: boolean
        }
        Insert: {
          brand?: string | null
          carb_per_100g?: number
          category?: string | null
          created_at?: string
          created_by?: string | null
          default_serving_g?: number | null
          fat_per_100g?: number
          id?: string
          kcal_per_100g: number
          name: string
          name_normalized?: string | null
          protein_per_100g?: number
          serving_label?: string | null
          source?: string
          tags?: string[]
          updated_at?: string
          verified?: boolean
        }
        Update: {
          brand?: string | null
          carb_per_100g?: number
          category?: string | null
          created_at?: string
          created_by?: string | null
          default_serving_g?: number | null
          fat_per_100g?: number
          id?: string
          kcal_per_100g?: number
          name?: string
          name_normalized?: string | null
          protein_per_100g?: number
          serving_label?: string | null
          source?: string
          tags?: string[]
          updated_at?: string
          verified?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          goal_carb: number | null
          goal_fat: number | null
          goal_kcal: number | null
          goal_protein: number | null
          id: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          goal_carb?: number | null
          goal_fat?: number | null
          goal_kcal?: number | null
          goal_protein?: number | null
          id: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          goal_carb?: number | null
          goal_fat?: number | null
          goal_kcal?: number | null
          goal_protein?: number | null
          id?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      recipe_ingredients: {
        Row: {
          grams: number
          id: string
          note: string | null
          product_id: string | null
          recipe_id: string
          sort_order: number
        }
        Insert: {
          grams: number
          id?: string
          note?: string | null
          product_id?: string | null
          recipe_id: string
          sort_order?: number
        }
        Update: {
          grams?: number
          id?: string
          note?: string | null
          product_id?: string | null
          recipe_id?: string
          sort_order?: number
        }
        Relationships: []
      }
      recipes: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          equipment: string[]
          id: string
          instructions: string | null
          name: string
          needs_cooking: boolean
          prep_minutes: number | null
          servings: number
          source: string
          tags: string[]
          updated_at: string
          verified: boolean
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          equipment?: string[]
          id?: string
          instructions?: string | null
          name: string
          needs_cooking?: boolean
          prep_minutes?: number | null
          servings?: number
          source?: string
          tags?: string[]
          updated_at?: string
          verified?: boolean
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          equipment?: string[]
          id?: string
          instructions?: string | null
          name?: string
          needs_cooking?: boolean
          prep_minutes?: number | null
          servings?: number
          source?: string
          tags?: string[]
          updated_at?: string
          verified?: boolean
        }
        Relationships: []
      }
      shopping_list_items: {
        Row: {
          checked: boolean
          created_at: string
          id: string
          list_id: string
          needed_g: number
          package_id: string | null
          packages_qty: number | null
          product_id: string | null
        }
        Insert: {
          checked?: boolean
          created_at?: string
          id?: string
          list_id: string
          needed_g: number
          package_id?: string | null
          packages_qty?: number | null
          product_id?: string | null
        }
        Update: {
          checked?: boolean
          created_at?: string
          id?: string
          list_id?: string
          needed_g?: number
          package_id?: string | null
          packages_qty?: number | null
          product_id?: string | null
        }
        Relationships: []
      }
      shopping_lists: {
        Row: {
          created_at: string
          id: string
          period_end: string | null
          period_start: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          title?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      vaults: {
        Row: {
          blob: string
          size_bytes: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          blob: string
          size_bytes?: number
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          blob?: string
          size_bytes?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
    }
    Views: {
      products_public: {
        Row: {
          brand: string | null
          carb_per_100g: number | null
          category: string | null
          default_serving_g: number | null
          fat_per_100g: number | null
          id: string | null
          kcal_per_100g: number | null
          name: string | null
          protein_per_100g: number | null
          serving_label: string | null
          source: string | null
          tags: string[] | null
          verified: boolean | null
        }
      }
      recipe_macros: {
        Row: {
          carb: number | null
          fat: number | null
          kcal: number | null
          protein: number | null
          recipe_id: string | null
          total_grams: number | null
        }
      }
      product_quality: {
        Row: {
          id: string | null
          name: string | null
          category: string | null
          energy_density: number | null
          protein_per_100kcal: number | null
          is_discretionary: boolean | null
          quality_label: string | null
        }
      }
    }
    Functions: {
      generate_shopping_list: {
        Args: { p_plan: Json }
        Returns: {
          in_pantry: boolean
          needed_g: number
          package_amount_g: number
          package_label: string
          packages_qty: number
          product_id: string
          product_name: string
        }[]
      }
      suggest_recipes: {
        Args: {
          can_cook?: boolean
          max_results?: number
          target_kcal: number
          target_protein?: number
          tolerance?: number
        }
        Returns: {
          carb_serv: number
          category: string
          fat_serv: number
          kcal_serv: number
          name: string
          needs_cooking: boolean
          protein_serv: number
          recipe_id: string
          score: number
          within_tolerance: boolean
        }[]
      }
      suggest_alternatives: {
        Args: { p_product_id: string; max_results?: number }
        Returns: {
          product_id: string
          name: string
          category: string
          kcal_per_100g: number
          protein_per_100g: number
          protein_per_100kcal: number
          kcal_saved_per_100g: number
          protein_gained_per_100g: number
        }[]
      }
      suggest_day: {
        Args: {
          target_kcal: number
          target_protein?: number
          can_cook?: boolean
          meals?: number
          tolerance?: number
        }
        Returns: {
          slot: number
          recipe_id: string
          name: string
          kcal_serv: number
          protein_serv: number
          running_kcal: number
          running_protein: number
        }[]
      }
      log_recipe: {
        Args: {
          p_recipe_id: string
          p_servings?: number
          p_meal?: string
          p_date?: string
        }
        Returns: {
          carb: number
          created_at: string
          entry_date: string
          fat: number
          grams: number
          id: string
          kcal: number
          meal: string | null
          product_id: string | null
          product_name: string
          protein: number
          user_id: string
        }
      }
      calculate_targets: {
        Args: {
          weight_kg: number
          height_cm: number
          age: number
          sex: string
          activity?: string
          goal?: string
        }
        Returns: {
          kcal: number
          protein_g: number
          fat_g: number
          carb_g: number
          bmr: number
          tdee: number
        }[]
      }
      search_products_fuzzy: {
        Args: { q: string; max_results?: number }
        Returns: {
          id: string
          name: string
          brand: string
          category: string
          kcal_per_100g: number
          protein_per_100g: number
          fat_per_100g: number
          carb_per_100g: number
          default_serving_g: number
          serving_label: string
          verified: boolean
          sim: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
