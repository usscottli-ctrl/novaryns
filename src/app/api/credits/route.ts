import { NextResponse } from "next/server";
import {
  dbEnabled,
  getCreditOverview,
  listUserLedgerFiltered,
} from "@/lib/db";
import { emailFromToken, bearer } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 用户端「积分明细」:余额 + 最近到期 + 流水(按类别筛选,仅 30 天内)。
// 只允许本人(登录 token 的 email = 查询 email)或管理员查看。
export async function GET(request: Request) {
  if (!dbEnabled) return NextResponse.json({ persisted: false });
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const kind = url.searchParams.get("kind") ?? "all";
  if (!email) {
    return NextResponse.json({ error: "缺少 email" }, { status: 400 });
  }
  const tokenEmail = await emailFromToken(bearer(request));
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!tokenEmail || (tokenEmail !== email && tokenEmail !== adminEmail)) {
    return NextResponse.json({ error: "请重新登录后再查看" }, { status: 401 });
  }
  try {
    const [overview, items] = await Promise.all([
      getCreditOverview(email),
      listUserLedgerFiltered(email, { kind, sinceDays: 30, limit: 200 }),
    ]);
    return NextResponse.json({
      persisted: true,
      balance: overview.balance,
      nextExpiry: overview.nextExpiry,
      items,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取失败" },
      { status: 500 }
    );
  }
}
