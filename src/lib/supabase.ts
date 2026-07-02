import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser Supabase client (anon key) — used client-side for auth only.
// NEXT_PUBLIC_* are inlined at build time, so this is safe in client code.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let client: SupabaseClient | null = null;

export function browserSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/**
 * Returns an `{ Authorization: "Bearer <token>" }` header for the current
 * session (or `{}` if not logged in / auth disabled). Attach to credit-spending
 * API calls (generate / suite) so the server can bind the request to a real
 * session instead of trusting a client-supplied email. Safe with FormData
 * bodies — it only adds Authorization, never Content-Type.
 */
export async function authHeader(): Promise<Record<string, string>> {
  if (!url || !anon) return {};
  try {
    const { data } = await browserSupabase().auth.getSession();
    const tok = data.session?.access_token;
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  } catch {
    return {};
  }
}
