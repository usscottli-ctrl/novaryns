import "server-only";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

// 口令哈希(scrypt + 随机 salt),存 "scrypt$<saltHex>$<hashHex>"。
// 独立模块:admin-auth(管理员密码)与 native-auth(用户密码)共用,避免相互 import 成环。
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

// 定长比较,防时序侧信道。
export function verifyPassword(pw: string, stored: string): boolean {
  try {
    const [algo, saltHex, hashHex] = stored.split("$");
    if (algo !== "scrypt" || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(pw, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
