import { NextResponse } from "next/server";
import { nativeUserEmail } from "@/lib/native-auth";
import { getUser } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 原生多用户:当前会话对应的用户(前端 hydrate 用)。无会话返回 { user: null }。
export async function GET(req: Request) {
  const email = nativeUserEmail(req);
  if (!email) return NextResponse.json({ user: null });
  const user = await getUser(email);
  return NextResponse.json({ user });
}
