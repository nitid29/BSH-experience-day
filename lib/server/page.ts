import "server-only";
import type { RealtimeInfo } from "@/lib/client";

/** Public Realtime credentials (the anon key is designed to be public; RLS protects the data). */
export function realtimeInfo(): RealtimeInfo {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && anonKey ? { url, anonKey } : null;
}
