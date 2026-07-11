import "server-only";
import crypto from "crypto";

// 邮箱验证码(原生多用户注册用):内存存哈希,10 分钟有效,最多试 5 次。
// 单实例部署(docker/pm2 常驻进程)内存即可;重启丢码让用户重发,可接受。
type Entry = { hash: string; exp: number; tries: number };
const codes = new Map<string, Entry>();

function sha(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function sweep() {
  const now = Date.now();
  codes.forEach((v, k) => {
    if (now > v.exp) codes.delete(k);
  });
}

export function issueEmailCode(emailRaw: string): string {
  sweep();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  codes.set(emailRaw.toLowerCase(), {
    hash: sha(code),
    exp: Date.now() + 10 * 60_000,
    tries: 0,
  });
  return code;
}

export function verifyEmailCode(emailRaw: string, code: string): boolean {
  const k = emailRaw.toLowerCase();
  const e = codes.get(k);
  if (!e) return false;
  if (Date.now() > e.exp || e.tries >= 5) {
    codes.delete(k);
    return false;
  }
  e.tries++;
  const a = Buffer.from(sha(code));
  const b = Buffer.from(e.hash);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (ok) codes.delete(k); // 一次性:验证通过即销毁
  return ok;
}
