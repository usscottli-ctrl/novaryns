import { NextResponse } from "next/server";
import { dbEnabled, getOrder, ensureProLicenseForOrder } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Order status lookup. Order ids are unguessable; used by the frontend to poll
// and by the cashier to render. Returns only display-safe fields.
export async function GET(req: Request) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "缺少订单号" }, { status: 400 });
  }
  const o = await getOrder(id);
  if (!o) {
    return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  }
  // Pro 直售订单已付 → 附带 License Key(幂等懒补:回调侧若没生成这里补上)。
  let licenseKey: string | null = null;
  if (o.kind === "pro" && o.status === "paid") {
    licenseKey = await ensureProLicenseForOrder(o.id, o.email).catch(() => null);
  }
  return NextResponse.json({
    id: o.id,
    status: o.status,
    kind: o.kind,
    title: o.title,
    credits: o.credits,
    amount: o.amount,
    email: o.email,
    ...(licenseKey ? { licenseKey } : {}),
  });
}
