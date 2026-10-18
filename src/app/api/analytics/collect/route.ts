import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { dbEnabled, recordPageView, purgeOldPageViews } from "@/lib/db";
import { clientIp } from "@/lib/ip";
import {
  ANALYTICS_RETENTION_DAYS,
  analyticsEnabled,
  cleanPath,
  isBotUa,
  isTrackablePath,
  parseBrowser,
  parseDevice,
  refererHost,
} from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// 访问统计采集端点。前端 <Tracker> 用 navigator.sendBeacon 打过来。
//
// 设计约束:
//  · **永远返回 204,永远不抛**。统计挂了不能影响用户浏览,也不能给攻击者
//    任何可探测的返回差异。
//  · 不落原始 IP / 完整 UA(见 lib/analytics.ts 顶部说明)。
//  · 无 DB / 关了开关 → 直接 204,不做任何事。
// ---------------------------------------------------------------------------

const NO_CONTENT = new NextResponse(null, { status: 204 });

// 同一 IP 每分钟最多这么多条,防止有人拿脚本刷 PV 把表撑爆。
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { n: number; reset: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || now > cur.reset) {
    hits.set(key, { n: 1, reset: now + RATE_WINDOW_MS });
    // 顺手清掉过期条目,别让这个 Map 无限长大(单进程内存)。
    if (hits.size > 5000) {
      hits.forEach((v, k) => {
        if (now > v.reset) hits.delete(k);
      });
    }
    return false;
  }
  cur.n += 1;
  return cur.n > RATE_LIMIT;
}

// 地理库(可选依赖)。装了 → 解析国家;没装 → 整个模块记为不可用,只记 null。
// 只尝试加载一次,失败不重试。
type GeoLookup = (ip: string) => { country?: string } | null;
let geoLookup: GeoLookup | null | undefined;
async function lookupCountry(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  if (geoLookup === undefined) {
    try {
      const mod = await import("geoip-lite");
      geoLookup = (mod.default?.lookup ?? mod.lookup) as GeoLookup;
    } catch {
      geoLookup = null;
    }
  }
  if (!geoLookup) return null;
  try {
    const rec = geoLookup(ip);
    const c = (rec?.country || "").toUpperCase();
    return /^[A-Z]{2}$/.test(c) ? c : null;
  } catch {
    return null;
  }
}

/** 访客指纹:站点密钥 + IP + UA 的不可逆哈希,取前 32 位十六进制。 */
function visitorHash(ip: string | null, ua: string): string {
  const salt = process.env.SETTINGS_SECRET || "novaryns-analytics";
  return createHash("sha256")
    .update(`${salt}|${ip ?? "noip"}|${ua}`)
    .digest("hex")
    .slice(0, 32);
}

export async function POST(req: Request) {
  try {
    if (!dbEnabled || !analyticsEnabled()) return NO_CONTENT;

    const ua = req.headers.get("user-agent") || "";
    if (isBotUa(ua)) return NO_CONTENT;

    const ip = clientIp(req);
    if (rateLimited(ip ?? "unknown")) return NO_CONTENT;

    // sendBeacon 发的是 text/plain,不能直接 req.json()。
    let body: { path?: string; ref?: string; locale?: string; sid?: string };
    try {
      body = JSON.parse(await req.text());
    } catch {
      return NO_CONTENT;
    }

    const path = cleanPath(body.path || "/");
    if (!isTrackablePath(path)) return NO_CONTENT;

    // 国家优先信 Cloudflare 的头(海外站在 CF 后面,准且免费);
    // 没有(国内站直连阿里云 Caddy)才回退本地地理库。
    const cf = (req.headers.get("cf-ipcountry") || "").toUpperCase();
    const country =
      /^[A-Z]{2}$/.test(cf) && cf !== "XX" && cf !== "T1"
        ? cf
        : await lookupCountry(ip);

    const selfHost = req.headers.get("host") || "";
    await recordPageView({
      path,
      visitor: visitorHash(ip, ua),
      sid: (body.sid || "").slice(0, 40),
      country,
      device: parseDevice(ua),
      browser: parseBrowser(ua),
      refHost: refererHost(body.ref || "", selfHost),
      locale: (body.locale || "").slice(0, 12),
    });

    // 保留期清理:每 ~500 次写入顺手跑一次,不为这点事单开定时任务。
    if (Math.random() < 0.002) {
      void purgeOldPageViews(ANALYTICS_RETENTION_DAYS).catch(() => {});
    }
  } catch {
    /* 统计失败静默 —— 绝不影响访问 */
  }
  return NO_CONTENT;
}
