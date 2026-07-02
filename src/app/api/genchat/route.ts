import { NextResponse } from "next/server";
import {
  dbEnabled,
  listGenchatSessions,
  getGenchatSession,
  saveGenchatSession,
  deleteGenchatSession,
} from "@/lib/db";

// 沿用本站「按 email 信任」模式(同 /api/account、/api/projects)。
// 会话内容只是提示词+生成图 URL,无敏感数据。

export async function GET(request: Request) {
  if (!dbEnabled) return NextResponse.json({ sessions: [] });
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") ?? "").trim();
  const session = (url.searchParams.get("session") ?? "").trim();
  if (!email) return NextResponse.json({ sessions: [] });
  if (session) {
    const s = await getGenchatSession(email, session).catch(() => null);
    return NextResponse.json({ session: s });
  }
  const sessions = await listGenchatSessions(email).catch(() => []);
  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  if (!dbEnabled) return NextResponse.json({ ok: true });
  let body: {
    email?: string;
    id?: string;
    title?: string;
    turns?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const id = (body.id ?? "").trim();
  if (!email || !id) {
    return NextResponse.json({ error: "missing email/id" }, { status: 400 });
  }
  await saveGenchatSession(email, id, body.title ?? "", body.turns ?? []).catch(
    () => {}
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!dbEnabled) return NextResponse.json({ ok: true });
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") ?? "").trim();
  const session = (url.searchParams.get("session") ?? "").trim();
  if (!email || !session) {
    return NextResponse.json({ error: "missing" }, { status: 400 });
  }
  await deleteGenchatSession(email, session).catch(() => {});
  return NextResponse.json({ ok: true });
}
