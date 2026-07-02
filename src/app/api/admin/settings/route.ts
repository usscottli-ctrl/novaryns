import { NextResponse } from "next/server";
import { dbEnabled, setSignupBonus } from "@/lib/db";
import {
  decryptFromClient,
  getAdminView,
  saveOpenAIKey,
  saveOpenAIModel,
  saveCutoutModel,
  saveCutoutBackend,
  saveReplicateToken,
  saveReplicateModel,
  saveWechatLogin,
  saveWechatSecret,
  savePayEnabled,
  saveAlipay,
  saveAlipayPrivateKey,
  saveWxpay,
  saveWxpayApiv3,
  saveWxpayCert,
  saveWxpayCertSerial,
  saveWxpayAppid,
  saveBrand,
  saveAssistConfig,
  saveAssistKey,
} from "@/lib/settings";
import { isAdminToken, bearer } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: Request): Promise<NextResponse | null> {
  if (!dbEnabled) {
    return NextResponse.json(
      { error: "未配置数据库，管理设置不可用" },
      { status: 503 }
    );
  }
  if (!(await isAdminToken(bearer(req)))) {
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  return NextResponse.json(await getAdminView());
}

export async function POST(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;

  let body: {
    model?: string;
    cutoutModel?: string;
    cutoutBackend?: string;
    replicateModel?: string;
    encryptedKey?: string;
    encryptedReplicateToken?: string;
    signupBonus?: number;
    // 微信登录(明文)
    wechatAppid?: string;
    wechatToken?: string;
    wechatEmailDomain?: string;
    // 支付(明文)
    alipayAppid?: string;
    alipayPublicKey?: string;
    wxpayMchid?: string;
    wxpayCertSerial?: string;
    wxpayAppid?: string;
    payEnabled?: boolean;
    // 品牌与白标(Pro,明文;空串=清除覆盖→回退 env 默认)
    brandName?: string;
    brandLogo?: string;
    // AI 帮写 / 文案模型(明文;空串=清除→回退默认 gpt-4o-mini / 跟随 OpenAI)
    assistModel?: string;
    assistBaseUrl?: string;
    encryptedAssistKey?: string;
    // 加密类(浏览器 RSA 密文)
    encryptedWechatSecret?: string;
    encryptedAlipayPrivateKey?: string;
    encryptedWxpayApiv3?: string;
    encryptedWxpayCert?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  // 解出浏览器 RSA 密文 → 明文;解密失败/为空回 null,调用方据此回 400。
  async function decryptField(b64: unknown): Promise<string | null> {
    if (typeof b64 !== "string" || !b64.trim()) return null;
    try {
      const plain = await decryptFromClient(b64);
      return plain && plain.trim() ? plain : null;
    } catch {
      return null;
    }
  }

  try {
    if (typeof body.model === "string" && body.model.trim()) {
      await saveOpenAIModel(body.model);
    }
    if (typeof body.cutoutModel === "string" && body.cutoutModel.trim()) {
      await saveCutoutModel(body.cutoutModel);
    }
    if (
      typeof body.cutoutBackend === "string" &&
      body.cutoutBackend.trim()
    ) {
      await saveCutoutBackend(body.cutoutBackend);
    }
    if (typeof body.replicateModel === "string" && body.replicateModel.trim()) {
      await saveReplicateModel(body.replicateModel);
    }
    if (typeof body.signupBonus === "number" && Number.isFinite(body.signupBonus)) {
      await setSignupBonus(body.signupBonus);
    }
    if (body.encryptedKey) {
      const plain = await decryptFromClient(body.encryptedKey);
      if (!plain || plain.length < 8) {
        return NextResponse.json(
          { error: "解密后的 key 无效" },
          { status: 400 }
        );
      }
      await saveOpenAIKey(plain);
    }
    if (body.encryptedReplicateToken) {
      const plain = await decryptFromClient(body.encryptedReplicateToken);
      if (!plain || plain.length < 8) {
        return NextResponse.json(
          { error: "解密后的 Replicate Token 无效" },
          { status: 400 }
        );
      }
      await saveReplicateToken(plain);
    }

    // ---- 微信登录:明文字段(空串自动跳过) ----
    if (
      (typeof body.wechatAppid === "string" && body.wechatAppid.trim()) ||
      (typeof body.wechatToken === "string" && body.wechatToken.trim()) ||
      (typeof body.wechatEmailDomain === "string" &&
        body.wechatEmailDomain.trim())
    ) {
      await saveWechatLogin({
        appid: body.wechatAppid,
        token: body.wechatToken,
        emailDomain: body.wechatEmailDomain,
      });
    }
    // 微信 AppSecret(加密)
    if (typeof body.encryptedWechatSecret === "string" && body.encryptedWechatSecret.trim()) {
      const plain = await decryptField(body.encryptedWechatSecret);
      if (!plain) {
        return NextResponse.json(
          { error: "解密后的微信 AppSecret 无效" },
          { status: 400 }
        );
      }
      await saveWechatSecret(plain);
    }

    // ---- 支付:明文字段 ----
    if (typeof body.payEnabled === "boolean") {
      await savePayEnabled(body.payEnabled);
    }
    if (
      (typeof body.alipayAppid === "string" && body.alipayAppid.trim()) ||
      (typeof body.alipayPublicKey === "string" && body.alipayPublicKey.trim())
    ) {
      await saveAlipay({
        appid: body.alipayAppid,
        publicKey: body.alipayPublicKey,
      });
    }
    if (typeof body.wxpayMchid === "string" && body.wxpayMchid.trim()) {
      await saveWxpay({ mchid: body.wxpayMchid });
    }
    if (typeof body.wxpayCertSerial === "string" && body.wxpayCertSerial.trim()) {
      await saveWxpayCertSerial(body.wxpayCertSerial);
    }
    if (typeof body.wxpayAppid === "string" && body.wxpayAppid.trim()) {
      await saveWxpayAppid(body.wxpayAppid);
    }
    // 支付加密字段
    if (typeof body.encryptedAlipayPrivateKey === "string" && body.encryptedAlipayPrivateKey.trim()) {
      const plain = await decryptField(body.encryptedAlipayPrivateKey);
      if (!plain) {
        return NextResponse.json(
          { error: "解密后的支付宝应用私钥无效" },
          { status: 400 }
        );
      }
      await saveAlipayPrivateKey(plain);
    }
    if (typeof body.encryptedWxpayApiv3 === "string" && body.encryptedWxpayApiv3.trim()) {
      const plain = await decryptField(body.encryptedWxpayApiv3);
      if (!plain) {
        return NextResponse.json(
          { error: "解密后的微信支付 APIv3 Key 无效" },
          { status: 400 }
        );
      }
      await saveWxpayApiv3(plain);
    }
    if (typeof body.encryptedWxpayCert === "string" && body.encryptedWxpayCert.trim()) {
      const plain = await decryptField(body.encryptedWxpayCert);
      if (!plain) {
        return NextResponse.json(
          { error: "解密后的微信支付商户证书无效" },
          { status: 400 }
        );
      }
      await saveWxpayCert(plain);
    }

    // ---- 品牌与白标(Pro):明文;空串 = 清除覆盖 → 前台回退 env 默认 ----
    // 注意:用 typeof 判断「字段是否出现」,空串也要写入(=清除),不能用真值跳过。
    if (typeof body.brandName === "string" || typeof body.brandLogo === "string") {
      await saveBrand({ name: body.brandName, logo: body.brandLogo });
    }

    // ---- AI 帮写 / 文案模型:明文 模型名/BaseURL(空串=清除→回退默认);Key 加密 ----
    if (
      typeof body.assistModel === "string" ||
      typeof body.assistBaseUrl === "string"
    ) {
      await saveAssistConfig({
        model: body.assistModel,
        baseUrl: body.assistBaseUrl,
      });
    }
    if (typeof body.encryptedAssistKey === "string" && body.encryptedAssistKey.trim()) {
      const plain = await decryptField(body.encryptedAssistKey);
      if (!plain) {
        return NextResponse.json(
          { error: "解密后的帮写模型 Key 无效" },
          { status: 400 }
        );
      }
      await saveAssistKey(plain);
    }
    return NextResponse.json(await getAdminView());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 }
    );
  }
}
