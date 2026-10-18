import { NextResponse } from "next/server";
import { dbEnabled, analyticsOverview } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import type { AnalyticsOverview } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 后台「访问统计」面板取数。?days=1|7|30|90
export async function GET(req: Request) {
  if (!dbEnabled)
    return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  if (!(await requireAdmin(req)))
    return NextResponse.json({ error: "未授权" }, { status: 401 });

  const days = Number(new URL(req.url).searchParams.get("days") || 7) || 7;
  const data = await analyticsOverview(days);

  // 地理库装没装,决定前端是否提示「国家未解析」。CF 头在的话即使没装库也有国家,
  // 所以只要本区间里出现过任一非空国家,就当解析正常。
  const geoReady = data.countries.some((c) => c.key !== "未知");
  const payload: AnalyticsOverview = { ...data, geoReady };
  return NextResponse.json(payload);
}
