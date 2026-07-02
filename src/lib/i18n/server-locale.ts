import { cookies, headers } from "next/headers";
import { normalizeLocale, type Locale } from "@/lib/i18n/dict";

/**
 * 服务端取界面语言(SSR / RSC 用):
 *   1) 已有 novaryns_locale cookie(用户手动切换过)→ 以 cookie 为准;
 *   2) 否则按浏览器 Accept-Language 判断:最优先语言是英文 → en;其余一律中文。
 *
 * 设计取舍:主力是中文用户群体,海外站只给 GitHub 英文用户试用,
 * 所以非英文浏览器一律回落中文,只有明确英文偏好才给英文。
 */
export function getServerLocale(): Locale {
  const cookie = cookies().get("novaryns_locale")?.value;
  if (cookie) return normalizeLocale(cookie);
  const al = (headers().get("accept-language") ?? "").toLowerCase();
  const first = al.split(",")[0]?.trim() ?? "";
  return first.startsWith("en") ? "en" : "zh";
}
