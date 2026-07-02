import { NextResponse } from "next/server";
import { smsEnabled, sendSmsCode } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHONE_RE = /^1[3-9]\d{9}$/;

// POST { phone } → send an SMS verify code (Aliyun manages the code).
export async function POST(req: Request) {
  if (!smsEnabled) {
    return NextResponse.json(
      { ok: false, error: "phone login not configured" },
      { status: 503 }
    );
  }
  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const phone = String(body?.phone ?? "").trim();
  if (!PHONE_RE.test(phone)) {
    return NextResponse.json(
      { ok: false, error: "invalid phone" },
      { status: 400 }
    );
  }
  const r = await sendSmsCode(phone);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
