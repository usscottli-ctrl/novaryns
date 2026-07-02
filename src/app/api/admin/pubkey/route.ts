import { NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { getPublicKeyPem } from "@/lib/settings";
import { isAdminToken, bearer } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RSA public key used to encrypt the API key in the browser before sending.
// Gated to the admin user (it can only encrypt, but no reason to expose it).
export async function GET(req: Request) {
  if (!dbEnabled) {
    return NextResponse.json(
      { error: "未配置数据库，管理设置不可用" },
      { status: 503 }
    );
  }
  if (!(await isAdminToken(bearer(req)))) {
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  }
  try {
    return NextResponse.json({ pem: await getPublicKeyPem() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成密钥失败" },
      { status: 500 }
    );
  }
}
