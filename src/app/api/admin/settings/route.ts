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
} from "@/lib/settings";
import { requireAdmin } from "@/lib/admin-auth";
import { proEnabled } from "@/lib/edition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: Request): Promise<NextResponse | null> {
  if (!dbEnabled) {
    return NextResponse.json(
      { error: "未配置数据库，管理设置不可用" },
      { status: 503 }
    );
  }
  if (!(await requireAdmin(req))) {
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

  // Pro 门控(方案 B 后端加固):**收款**是 Pro 能力。开源版(!pro)静默剥离这些字段,
  // 防 curl 绕过前端门控直接写入;OpenAI Key/模型/抠图/微信登录等**基础配置照常保存**,
  // 不影响开源版自配置。官方云/已激活 Pro → pro=true,全部正常。
  // 注意:**站点名 + Logo(brandName/brandLogo)是开源版基础自定义能力,不剥离**——
  // 自部署者本就该给自己的站起名换 logo;真正的 Pro 白标钩子是"去掉底部 Powered by
  // 署名"(由 site-footer 按 pro 强制,与此处保存无关)。
  // ⚠️以后新增「收款/多用户/后台高阶」类 Pro 写字段,记得也加进这个剥离清单。
  if (!(await proEnabled())) {
    body.payEnabled = undefined;
    body.alipayAppid = undefined;
    body.alipayPublicKey = undefined;
    body.encryptedAlipayPrivateKey = undefined;
    body.wxpayMchid = undefined;
    body.wxpayCertSerial = undefined;
    body.wxpayAppid = undefined;
    body.encryptedWxpayApiv3 = undefined;
    body.encryptedWxpayCert = undefined;
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
    return NextResponse.json(await getAdminView());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 }
    );
  }
}
