import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { buildVersion } from "@/lib/version";
import { editionName } from "@/lib/edition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 后台更新检查(仅管理员)。
// 版本源 = 开源仓 main 的最新 commit 时间(GitHub API)——这才是"最新可装版本"
// 的权威;镜像的 BUILD_VERSION 也是所构建 commit 的时间戳,两边同源可比,
// 相等 = 已是最新。(旧方案比官方站的**部署时刻**,同一份代码只要官方站部署
// 得晚就误报"有新版本",已废弃。)
const OSS_COMMITS_API =
  "https://api.github.com/repos/usscottli-ctrl/novaryns/commits/main";

export async function GET(req: Request) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  }
  // 官方云实例始终自动最新,不做检查(也避免主仓部署时间与开源仓 commit 不可比)。
  if (editionName === "cloud") {
    return NextResponse.json({
      current: buildVersion(),
      latest: buildVersion(),
      currentLabel: "云端自动更新",
      latestLabel: "云端自动更新",
      updateAvailable: false,
      reachable: false,
      updateCmd: "",
    });
  }
  const current = buildVersion();
  let latest = current;
  let reachable = false;
  try {
    const r = await fetch(OSS_COMMITS_API, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "novaryns-update-check",
      },
    });
    const d = (await r.json().catch(() => null)) as {
      commit?: { committer?: { date?: string } };
    } | null;
    const dateStr = d?.commit?.committer?.date;
    if (r.ok && dateStr) {
      const ts = Math.floor(Date.parse(dateStr) / 1000);
      if (Number.isFinite(ts) && ts > 0) {
        latest = String(ts);
        reachable = true;
      }
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
    // 用 install.sh 更新:大陆走国内镜像拉最新版(compose pull 直连 ghcr 很慢),
    // 数据卷保留、表结构自动迁移,不丢数据。
    updateCmd:
      "curl -fsSL https://raw.githubusercontent.com/usscottli-ctrl/novaryns/main/install.sh | bash",
  });
}
