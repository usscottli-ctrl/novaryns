import "server-only";
import nodemailer from "nodemailer";
import { getSmtpConfig } from "@/lib/settings";

// SMTP 发信(忘记密码等)。未配置 SMTP 时返回 { ok:false }。永不抛错到调用方。
export async function sendMail(opts: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getSmtpConfig();
  if (!cfg) return { ok: false, error: "未配置邮件服务(SMTP)" };
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465, // 465=SSL;587/25=STARTTLS
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transporter.sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "发送失败" };
  }
}

export async function smtpConfigured(): Promise<boolean> {
  return !!(await getSmtpConfig());
}
