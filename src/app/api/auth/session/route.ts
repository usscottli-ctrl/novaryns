import { NextResponse } from "next/server";
import { nativeUserEmail } from "@/lib/native-auth";
import { getOrCreateUser, getUser } from "@/lib/db";
import { localAdminOk } from "@/lib/admin-auth";
import { supabaseEnabled } from "@/lib/auth-mode";
import { OPERATOR_EMAIL } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 当前会话对应的用户(前端 hydrate 用)。无会话返回 { user: null }。
//   · 原生多用户:nv_user 会话 → 该用户。
//   · 开源版单用户:本地管理员会话(nv_admin cookie)= 操作员身份。首次读时
//     顺手 getOrCreateUser 把操作员用户行建起来,让积分/作品/历史都挂它名下——
//     否则用户行缺失会导致 /api/account 把作品整个挡掉(展示为空)。
export async function GET(req: Request) {
  const email = nativeUserEmail(req);
  if (email) {
    return NextResponse.json({ user: await getUser(email) });
  }
  if (!supabaseEnabled && localAdminOk(req)) {
    const user = await getOrCreateUser(OPERATOR_EMAIL, "站长");
    return NextResponse.json({ user });
  }
  return NextResponse.json({ user: null });
}
