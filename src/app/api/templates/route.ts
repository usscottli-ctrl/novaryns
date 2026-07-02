import { NextResponse } from "next/server";
import { dbEnabled, listTemplatesPaged, syncTemplatesFromCode } from "@/lib/db";
import { TEMPLATES as SEED } from "@/lib/templates-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sync the bundled template list into the DB once per process (i.e. once per
// deploy, since pm2 restart spawns a fresh process). Inserts new templates,
// leaves existing rows untouched. Idempotent + race-safe.
let seedPromise: Promise<void> | null = null;
function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      await syncTemplatesFromCode(SEED);
    })().catch((e) => {
      seedPromise = null;
      throw e;
    });
  }
  return seedPromise;
}

// Paged: ?category=&q=&page=1&pageSize=24&ids=a,b,c
export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") || "1");
  const pageSize = Number(url.searchParams.get("pageSize") || "24");
  const category = (url.searchParams.get("category") || "").trim();
  const q = (url.searchParams.get("q") || "").trim();
  const idsParam = (url.searchParams.get("ids") || "").trim();
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : undefined;

  // DB off: serve a paged slice of the bundled list (mock mode).
  if (!dbEnabled) {
    const filtered = SEED.filter(
      (t) =>
        (!category || t.category === category) &&
        (!ids || ids.includes(t.id)) &&
        (!q ||
          t.title.toLowerCase().includes(q.toLowerCase()) ||
          t.industry.toLowerCase().includes(q.toLowerCase()) ||
          t.id.toLowerCase().includes(q.toLowerCase()) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q.toLowerCase())))
    );
    const start = (page - 1) * pageSize;
    return NextResponse.json({
      templates: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      persisted: false,
    });
  }

  try {
    await ensureSeeded();
    const { items, total } = await listTemplatesPaged({
      category: category || undefined,
      q: q || undefined,
      ids,
      page,
      pageSize,
    });
    // 降 egress:模板内容基本不变,让 CDN / 浏览器缓存响应(命中即不再打 DB)。
    // 5 分钟新鲜 + 1 天 stale-while-revalidate;每个 query 组合(分页/分类/搜索/ids)
    // 各自一份缓存。模板上新后最多 5 分钟内可见,可接受。
    return NextResponse.json(
      { templates: items, total, page, pageSize, persisted: true },
      {
        headers: {
          "Cache-Control":
            "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
        },
      }
    );
  } catch (e) {
    // 内部 DB 报错只在 server 端 log,前端只回通用文案(不漏表名/连接串等内部细节)
    console.error("[templates] db read failed:", e);
    return NextResponse.json({
      templates: SEED.slice(0, pageSize),
      total: SEED.length,
      page,
      pageSize,
      persisted: false,
      error: "db read failed",
    });
  }
}
