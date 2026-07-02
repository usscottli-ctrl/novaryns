import { NextResponse } from "next/server";
import { isWechatEnabled, pollWxSession, wxSyntheticEmail } from "@/lib/wechat";
import { adminSupabase } from "@/lib/supabase-admin";

// 轮询扫码登录会话。命中后按手机号登录同款方式建号/登录:
// openid → 合成邮箱({openid小写}-{短哈希}@wx.starzeco.com)→ Supabase 建用户
// → magiclink token_hash 回给前端 verifyOtp 建会话(登录即注册)。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isWechatEnabled()) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "wechat login not configured" }, { status: 503 });
  }
  const sid = (new URL(req.url).searchParams.get("sid") ?? "").trim();
  // sid 由 /start 生成(wxl + 32hex),格式不符直接拒绝
  if (!/^wxl[0-9a-f]{32}$/.test(sid)) {
    return NextResponse.json({ status: "expired" });
  }
  const s = pollWxSession(sid);
  if (s.status !== "done") {
    return NextResponse.json({ status: s.status });
  }

  const openid = s.openid;
  const email = await wxSyntheticEmail(openid);
  const sb = adminSupabase();
  let created = false;
  const { error: createErr } = await sb.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      name: `微信用户${openid.slice(-4)}`,
      via: "wechat",
      wx_openid: openid,
    },
  });
  if (!createErr) {
    created = true;
  } else if (!/registered|already|exists/i.test(createErr.message)) {
    return NextResponse.json(
      { status: "error", error: createErr.message },
      { status: 500 }
    );
  }

  const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return NextResponse.json(
      { status: "error", error: linkErr?.message || "session failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({
    status: "done",
    created,
    email,
    token_hash: tokenHash,
  });
}
