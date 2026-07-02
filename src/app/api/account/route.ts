import { NextResponse } from "next/server";
import {
  dbEnabled,
  getOrCreateUser,
  getUser,
  changeUserPlan,
  listArtworks,
  recordLoginIp,
} from "@/lib/db";
import { clientIp } from "@/lib/ip";
import type { PlanKey } from "@/lib/mock-data";
import { emailFromToken, bearer } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// 校验请求者(登录 token)是否有权看「该 email 的私有数据」:本人 或 管理员。
async function canSeePrivate(request: Request, email: string): Promise<boolean> {
  const tokenEmail = await emailFromToken(bearer(request));
  if (!tokenEmail) return false;
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  return tokenEmail === email.toLowerCase() || tokenEmail === adminEmail;
}

// Account / membership persistence. When the DB is disabled every response
// carries `persisted: false` so the client transparently uses its
// localStorage mock instead.

export async function GET(request: Request) {
  if (!dbEnabled) return NextResponse.json({ persisted: false });
  const email = new URL(request.url).searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "缺少 email 参数" }, { status: 400 });
  }
  try {
    const user = await getUser(email);
    // 防越权读:作品列表(图 URL + 提示词,较敏感)只返回给本人或管理员。
    // user 对象仍返回(登录态恢复要用),但他人查不到别人的作品内容。
    const allowed = user ? await canSeePrivate(request, email) : false;
    const artworks = allowed ? await listArtworks(email) : [];
    return NextResponse.json({ persisted: true, user, artworks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "数据库读取失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!dbEnabled) return NextResponse.json({ persisted: false });

  let body: { action?: string; email?: string; name?: string; plan?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  if (!email) {
    return NextResponse.json({ error: "缺少 email" }, { status: 400 });
  }

  try {
    if (body.action === "plan") {
      // 安全护栏:本端点是「信任模式」(只凭请求体里的 email,无登录态校验)。
      // 因此这里【只允许降级到免费版 starter】(= 取消会员,前端 account 页用)。
      // 任何付费套餐的开通/升级【必须】经过支付流程:
      //   createOrder → 国内收银台验真支付宝回调(HMAC) → fulfillOrder。
      // 否则任何人一条无鉴权 POST(带任意 email)就能免费升顶级套餐、白拿整月积分,直接资损。
      const target = (body.plan as PlanKey) ?? "starter";
      if (target !== "starter") {
        return NextResponse.json(
          { error: "付费套餐请通过购买开通", needPurchase: true },
          { status: 403 }
        );
      }
      // 防越权改:取消会员(降级 starter)必须是本人登录态(否则有人能把别人降级、清空积分)。
      const tokenEmail = await emailFromToken(bearer(request));
      if (!tokenEmail || tokenEmail !== email.toLowerCase()) {
        return NextResponse.json(
          { error: "请重新登录后再操作" },
          { status: 401 }
        );
      }
      const { user, invoice } = await changeUserPlan(email, "starter");
      return NextResponse.json({ persisted: true, user, invoice });
    }
    // default: sync (upsert + return). This fires on every login/session
    // bootstrap, so it's where we capture the user's latest login IP.
    const user = await getOrCreateUser(email, body.name ?? "");
    await recordLoginIp(email, clientIp(request));
    return NextResponse.json({ persisted: true, user });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "数据库写入失败" },
      { status: 500 }
    );
  }
}
