import { NextResponse } from "next/server";
import { dbEnabled, pingDb } from "@/lib/db";
import { storageEnabled } from "@/lib/storage";
import { getOpenAISettings } from "@/lib/settings";
import { authMode } from "@/lib/auth-mode";
import { proEnabled, editionName } from "@/lib/edition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-service connectivity check for local "接真实服务" verification.
// Visit /api/health after filling .env.local to confirm each integration.
export async function GET() {
  const db = await pingDb();
  const oai = await getOpenAISettings();
  const pro = await proEnabled();

  return NextResponse.json({
    db: { enabled: dbEnabled, ok: db.ok, error: db.error },
    storage: { enabled: storageEnabled },
    auth: { mode: authMode },
    openai: {
      enabled: !!oai.apiKey,
      model: oai.model,
      keySource: oai.source,
    },
    edition: editionName,
    pro,
  });
}
