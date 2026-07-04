import { NextResponse } from "next/server";
import { applySetup } from "@/lib/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// 首启配置向导落库接口。**首启专用、无需登录,但必须自锁**:
//   - 仅「未配置」的实例可写(applySetup 内部用 isConfigured() 判定);
//   - 已配置(含 NOVARYNS_EDITION=cloud 官方云、或已填 OpenAI Key)→ 403,写完即锁。
// 因此我们两站(env NOVARYNS_EDITION=cloud)永远返回 403,向导对线上站完全无害。
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  let body: {
    apiKey?: string;
    licenseKey?: string;
    siteName?: string;
    adminPassword?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  try {
    const result = await applySetup({
      apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
      licenseKey: typeof body.licenseKey === "string" ? body.licenseKey : "",
      siteName: typeof body.siteName === "string" ? body.siteName : "",
      adminPassword:
        typeof body.adminPassword === "string" ? body.adminPassword : "",
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch {
    // 净化:不外泄底层错误(可能含 openai/quota 等字样)。
    return NextResponse.json({ error: "保存失败,请稍后重试" }, { status: 500 });
  }
}
