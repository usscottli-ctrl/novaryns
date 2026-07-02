import { NextResponse } from "next/server";
import { adminSupabase, bearer } from "@/lib/supabase-admin";
import {
  dbEnabled,
  listUserFavs,
  addUserFav,
  removeUserFav,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve the requester's email from Bearer token. null = not authenticated. */
async function authEmail(req: Request): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  try {
    const { data, error } = await adminSupabase().auth.getUser(token);
    if (error || !data.user?.email) return null;
    return data.user.email.toLowerCase();
  } catch {
    return null;
  }
}

function guarded(): NextResponse | null {
  if (!dbEnabled) {
    return NextResponse.json(
      { error: "DB 未配置，收藏不可用" },
      { status: 503 }
    );
  }
  return null;
}

/** GET — 当前用户收藏的模板 ID 列表(string[],按收藏时间倒序)。 */
export async function GET(req: Request) {
  const blocked = guarded();
  if (blocked) return blocked;
  const email = await authEmail(req);
  if (!email)
    return NextResponse.json({ favs: [], authed: false }, { status: 401 });
  try {
    const favs = await listUserFavs(email);
    return NextResponse.json({ favs, authed: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取失败" },
      { status: 500 }
    );
  }
}

/** POST { templateId } — 加收藏。idempotent。 */
export async function POST(req: Request) {
  const blocked = guarded();
  if (blocked) return blocked;
  const email = await authEmail(req);
  if (!email)
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  let body: { templateId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  const tid = (body.templateId ?? "").trim();
  if (!tid || tid.length > 80)
    return NextResponse.json({ error: "templateId 无效" }, { status: 400 });
  try {
    await addUserFav(email, tid);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "写入失败" },
      { status: 500 }
    );
  }
}

/** DELETE ?templateId=xxx — 取消收藏。 */
export async function DELETE(req: Request) {
  const blocked = guarded();
  if (blocked) return blocked;
  const email = await authEmail(req);
  if (!email)
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  const url = new URL(req.url);
  const tid = (url.searchParams.get("templateId") ?? "").trim();
  if (!tid)
    return NextResponse.json({ error: "templateId 无效" }, { status: 400 });
  try {
    await removeUserFav(email, tid);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "删除失败" },
      { status: 500 }
    );
  }
}
