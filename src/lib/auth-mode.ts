// Pure env-flag module (NO SDK imports) so it's safe to import from anywhere.
// Auth provider priority: Supabase > built-in mock.
export const supabaseEnabled =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().length > 0 &&
  (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim().length > 0;

export type AuthMode = "supabase" | "mock";

export const authMode: AuthMode = supabaseEnabled ? "supabase" : "mock";
