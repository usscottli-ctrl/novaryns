import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbEnabled, sweepExpiredCloudTenants, sweepCloudExpiryReminders } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// 到期扫描(CN ECS 每日 cron 调用):active 且已过期 → 挂起。
// 用 PROVISIONER_SECRET 作 Bearer 保护(同机同信任域,cron 从 provisioner.env 读取)。
function authed(req: Request): boolean {
  const secret = process.env.PROVISIONER_SECRET || "";
  if (!secret) return false;
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!dbEnabled) return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  if (!authed(req)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  // 先发到期前提醒(active 且 7 天内到期),再挂起已过期的。
  const reminders = await sweepCloudExpiryReminders(7).catch(() => ({ reminded: [] as string[] }));
  const swept = await sweepExpiredCloudTenants();
  return NextResponse.json({ ok: true, ...swept, reminded: reminders.reminded });
}
