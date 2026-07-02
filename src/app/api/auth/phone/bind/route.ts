import { NextResponse } from "next/server";
import { smsEnabled, checkSmsCode } from "@/lib/sms";
import { adminSupabase, bearer } from "@/lib/supabase-admin";
import {
  findEmailByBoundPhone,
  authEmailExists,
  bindPhoneToEmail,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_DOMAIN = process.env.PHONE_EMAIL_DOMAIN ?? "phone.starzeco.com";

// POST { phone, code } with a Bearer token → verify the SMS code and bind the
// phone to the current (email) account, so they can also sign in by phone.
export async function POST(req: Request) {
  if (!smsEnabled || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  }
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sb = adminSupabase();
  const { data, error: uErr } = await sb.auth.getUser(token);
  const user = data?.user;
  if (uErr || !user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // Phone accounts already sign in by phone — nothing to bind here.
  if (user.email.endsWith(`@${EMAIL_DOMAIN}`)) {
    return NextResponse.json({ ok: false, error: "phone account" }, { status: 400 });
  }

  let body: { phone?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const phone = String(body?.phone ?? "").trim();
  const code = String(body?.code ?? "").trim();
  if (!PHONE_RE.test(phone)) {
    return NextResponse.json({ ok: false, error: "invalid phone" }, { status: 400 });
  }
  if (!/^\d{4,8}$/.test(code)) {
    return NextResponse.json({ ok: false, error: "invalid code" }, { status: 400 });
  }

  // Dedup: the phone must not belong to another account.
  const boundTo = await findEmailByBoundPhone(phone);
  if (boundTo && boundTo !== user.email) {
    return NextResponse.json({ ok: false, error: "phone in use" }, { status: 409 });
  }
  if (await authEmailExists(`${phone}@${EMAIL_DOMAIN}`)) {
    return NextResponse.json({ ok: false, error: "phone in use" }, { status: 409 });
  }

  // Verify the SMS code, then bind.
  const chk = await checkSmsCode(phone, code);
  if (!chk.ok) {
    return NextResponse.json(
      { ok: false, error: "code invalid or expired" },
      { status: 401 }
    );
  }
  const ok = await bindPhoneToEmail(user.email, phone);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "bind failed" }, { status: 500 });
  }
  // Stamp it on the user's metadata so the UI can show "bound" without an
  // extra round-trip.
  await sb.auth.admin.updateUserById(user.id, {
    user_metadata: { ...(user.user_metadata ?? {}), bound_phone: phone },
  });
  return NextResponse.json({ ok: true, phone });
}
