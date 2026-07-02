import "server-only";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// 阿里云「短信认证服务」(Dypnsapi) — managed phone OTP. We call SendSmsVerifyCode
// (Aliyun generates + sends + stores the code) and CheckSmsVerifyCode (Aliyun
// verifies it). Active only when all SMS_* / ALIYUN_SMS_* env vars are set
// (国内 instance only). 海外 leaves them unset → phone login is disabled.
// ---------------------------------------------------------------------------

const AK = process.env.ALIYUN_SMS_ACCESS_KEY_ID ?? "";
const SECRET = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET ?? "";
const SIGN_NAME = process.env.SMS_SIGN_NAME ?? "";
const TEMPLATE_CODE = process.env.SMS_TEMPLATE_CODE ?? "";
const VALID_SEC = Number(process.env.SMS_VALID_SEC ?? "300");
const CODE_LENGTH = process.env.SMS_CODE_LENGTH ?? "6";

export const smsEnabled = Boolean(AK && SECRET && SIGN_NAME && TEMPLATE_CODE);

const ENDPOINT = "https://dypnsapi.aliyuncs.com/";
const VERSION = "2017-05-25";

const pe = (s: string) =>
  encodeURIComponent(s)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");

async function call(
  action: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const common: Record<string, string> = {
    Format: "JSON",
    Version: VERSION,
    AccessKeyId: AK,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    SignatureVersion: "1.0",
    SignatureNonce:
      Date.now().toString() + Math.random().toString().slice(2, 8),
    Action: action,
  };
  const all: Record<string, string> = { ...common, ...params };
  const cqs = Object.keys(all)
    .sort()
    .map((k) => pe(k) + "=" + pe(all[k]))
    .join("&");
  const sts = "GET&" + pe("/") + "&" + pe(cqs);
  const sig = crypto.createHmac("sha1", SECRET + "&").update(sts).digest("base64");
  const url = ENDPOINT + "?" + cqs + "&Signature=" + pe(sig);
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  return (await res.json()) as Record<string, unknown>;
}

/** Send a verify code to a mainland-China phone. */
export async function sendSmsCode(
  phone: string
): Promise<{ ok: boolean; error?: string }> {
  const r = await call("SendSmsVerifyCode", {
    PhoneNumber: phone,
    SignName: SIGN_NAME,
    TemplateCode: TEMPLATE_CODE,
    TemplateParam: JSON.stringify({
      code: "##code##",
      min: String(Math.max(1, Math.round(VALID_SEC / 60))),
    }),
    CodeLength: CODE_LENGTH,
    ValidTime: String(VALID_SEC),
    Interval: "60",
    CountryCode: "86",
  });
  if (r?.Code === "OK") return { ok: true };
  return {
    ok: false,
    error: String(r?.Message ?? r?.Code ?? "send failed"),
  };
}

/** Verify a code the user entered. */
export async function checkSmsCode(
  phone: string,
  code: string
): Promise<{ ok: boolean; error?: string }> {
  const r = await call("CheckSmsVerifyCode", {
    PhoneNumber: phone,
    VerifyCode: code,
    CountryCode: "86",
  });
  const model = (r?.Model ?? {}) as { VerifyResult?: string };
  if (r?.Code === "OK" && model.VerifyResult === "PASS") return { ok: true };
  return {
    ok: false,
    error: String(model.VerifyResult ?? r?.Message ?? r?.Code ?? "verify failed"),
  };
}
