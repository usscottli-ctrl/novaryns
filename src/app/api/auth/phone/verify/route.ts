import { NextResponse } from "next/server";
import { smsEnabled, checkSmsCode } from "@/lib/sms";
import { adminSupabase } from "@/lib/supabase-admin";
import { findEmailByBoundPhone } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHONE_RE = /^1[3-9]\d{9}$/;
// Phone users get a synthetic email as their stable account identity. Display
// name is the phone number (see SessionBridge / auth-context).
const EMAIL_DOMAIN = process.env.PHONE_EMAIL_DOMAIN ?? "phone.starzeco.com";

// POST { phone, code } → verify the SMS code, then provision (login = register)
// a Supabase user and return a magic-link token_hash the client uses to
// establish a real session (verifyOtp).
export async function POST(req: Request) {
  if (!smsEnabled || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { ok: false, error: "phone login not configured" },
      { status: 503 }
    );
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

  // 1) Verify the SMS code with Aliyun.
  const chk = await checkSmsCode(phone, code);
  if (!chk.ok) {
    return NextResponse.json(
      { ok: false, error: "code invalid or expired" },
      { status: 401 }
    );
  }

  // 2) Resolve which account to log into.
  const sb = adminSupabase();
  let email: string;
  let created = false;

  // (a) An email account that bound this phone → log into that account.
  const boundEmail = await findEmailByBoundPhone(phone);
  if (boundEmail) {
    email = boundEmail;
  } else {
    // (b) Otherwise it's a phone account keyed by a synthetic email
    //     (login = register).
    email = `${phone}@${EMAIL_DOMAIN}`;
    const { error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name: phone, phone, via: "phone" },
    });
    if (!createErr) {
      created = true;
    } else if (!/registered|already|exists/i.test(createErr.message)) {
      return NextResponse.json(
        { ok: false, error: createErr.message },
        { status: 500 }
      );
    }
  }

  // 3) Mint a one-time magic-link token the client verifies to get a session.
  const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return NextResponse.json(
      { ok: false, error: linkErr?.message || "session failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, created, email, token_hash: tokenHash });
}
