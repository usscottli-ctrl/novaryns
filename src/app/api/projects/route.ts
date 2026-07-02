import { NextResponse } from "next/server";
import { dbEnabled, getProjectNames, setProjectName } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 画布项目自定义名:GET 拉某用户的全部项目名覆盖;POST 改某个项目名。
// 沿用本站既有的"按 email 信任"模式(同 /api/account、/api/favorites)。
export async function GET(request: Request) {
  if (!dbEnabled) return NextResponse.json({ names: {} });
  const email = (new URL(request.url).searchParams.get("email") ?? "").trim();
  if (!email) return NextResponse.json({ names: {} });
  const names = await getProjectNames(email).catch(() => ({}));
  return NextResponse.json({ names });
}

export async function POST(request: Request) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  }
  let body: { email?: string; key?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const key = (body.key ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!email || !key || !name) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  await setProjectName(email, key, name);
  return NextResponse.json({ ok: true, name: name.slice(0, 60) });
}
