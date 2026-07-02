import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only admin client (service_role). Used to create confirmed users so
// there's no email round-trip (poor deliverability to CN inboxes); flip to a
// real confirmation flow for production by removing email_confirm + enabling
// "Confirm email" in the Supabase dashboard.
export function adminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Verifies a Supabase access token and checks the user is the configured
// admin (ADMIN_EMAIL). Used to gate the in-app admin settings.
export async function isAdminToken(
  token: string | null | undefined
): Promise<boolean> {
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail || !token) return false;
  try {
    const { data, error } = await adminSupabase().auth.getUser(token);
    if (error || !data.user?.email) return false;
    return data.user.email.toLowerCase() === adminEmail;
  } catch {
    return false;
  }
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

// Verifies a Supabase access token and returns the authenticated user's email
// (lowercased), or null if the token is missing/invalid. Use this to bind a
// request to a real session instead of trusting a client-supplied email
// (prevents spending another user's credits via spoofed email).
export async function emailFromToken(
  token: string | null | undefined
): Promise<string | null> {
  if (!token) return null;
  try {
    const { data, error } = await adminSupabase().auth.getUser(token);
    if (error || !data.user?.email) return null;
    return data.user.email.toLowerCase();
  } catch {
    return null;
  }
}
