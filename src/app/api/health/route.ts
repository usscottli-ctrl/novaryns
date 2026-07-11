import { NextResponse } from "next/server";
import { dbEnabled, pingDb } from "@/lib/db";
import { storageEnabled } from "@/lib/storage";
import { getOpenAISettings } from "@/lib/settings";
import { authMode } from "@/lib/auth-mode";
import { proEnabled, editionName, isLicenseIssuer } from "@/lib/edition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-service connectivity check for local "接真实服务" verification.
// Visit /api/health after filling .env.local to confirm each integration.
export async function GET(request: Request) {
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
    // 本站是否为许可证签发站(host 判定):前端据此隐藏「我的授权」等签发站专属入口。
    issuer: isLicenseIssuer(request),
  });
}
