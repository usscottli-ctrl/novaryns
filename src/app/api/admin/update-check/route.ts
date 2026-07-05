import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { buildVersion, updateServer } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 后台更新检查(仅管理员):向官方站查最新构建版本,与本实例对比。
// 官方站始终部署最新代码,其 /api/version 即"最新可用版本"。
export async function GET(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  }
  const current = buildVersion();
  let latest = current;
  let reachable = false;
  try {
    const r = await fetch(`${updateServer()}/api/version`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    const d = (await r.json().catch(() => null)) as { version?: string } | null;
    if (d?.version) {
      latest = String(d.version);
      reachable = true;
    }
  } catch {
    /* 查不到就当无更新,不打扰 */
  }
  // 时间戳比较:latest 更大 = 有新版。current="0"(未注入版本)时不误报。
  const updateAvailable =
    reachable && current !== "0" && Number(latest) > Number(current);
  const fmt = (v: string) => {
    const n = Number(v);
    if (!n) return "未知";
    try {
      return new Date(n * 1000).toISOString().slice(0, 16).replace("T", " ");
    } catch {
      return v;
    }
  };
  return NextResponse.json({
    current,
    latest,
    currentLabel: fmt(current),
    latestLabel: fmt(latest),
    updateAvailable,
    reachable,
    updateCmd: "docker compose pull && docker compose up -d",
  });
}
