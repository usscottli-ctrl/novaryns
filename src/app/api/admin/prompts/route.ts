import { NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { getPromptConfigAdminView, savePromptConfig } from "@/lib/prompt-config";
import { isAdminToken, bearer } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: Request): Promise<NextResponse | null> {
  if (!dbEnabled) {
    return NextResponse.json({ error: "未配置数据库" }, { status: 503 });
  }
  if (!(await isAdminToken(bearer(req)))) {
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  return NextResponse.json(await getPromptConfigAdminView());
}

export async function POST(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  let body: {
    styles?: Record<string, string> | null;
    suiteSystem?: string | null;
    assistSystem?: string | null;
    optimizeSystem?: string | null;
    titleSystem?: string | null;
    suitePlatforms?: Record<string, string> | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  await savePromptConfig({
    styles: body.styles,
    suiteSystem: body.suiteSystem,
    assistSystem: body.assistSystem,
    optimizeSystem: body.optimizeSystem,
    titleSystem: body.titleSystem,
    suitePlatforms: body.suitePlatforms,
  });
  return NextResponse.json(await getPromptConfigAdminView());
}
