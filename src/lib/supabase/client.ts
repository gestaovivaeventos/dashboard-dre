"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "@/lib/supabase/env";

let client: SupabaseClient | undefined;

export function createClient() {
  if (!client) {
    const { supabaseAnonKey, supabaseUrl } = getSupabaseEnv();
    client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }

  return client;
}
