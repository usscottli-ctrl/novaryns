import { NextResponse } from "next/server";
import { USER_COOKIE } from "@/lib/native-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 原生多用户:退出登录(清会话 cookie)。
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
