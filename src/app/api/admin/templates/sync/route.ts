import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { proEnabled } from "@/lib/edition";
import {
  dbEnabled,
  getSetting,
  importTemplates,
  rewriteTemplateImagesToProxy,
} from "@/lib/db";

// 大陆浏览器对 *.r2.dev 有 SNI 阻断,直链会加载失败;导入时把图片改写为
// 本站同源代理(服务器直连 R2 没问题),客户浏览器只访问买家自己的站。
function proxifyImage(url: string | undefined): string {
  const u = (url ?? "").trim();
  if (/^https:\/\/[^/]+\.r2\.dev\//i.test(u)) {
    return `/api/tpl-image?u=${encodeURIComponent(u)}`;
  }
  return u;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 同步官方模板库(Pro 权益,仅管理员):凭本实例的 License Key 向官方站
// 分页拉取完整模板(含 prompt)并导入本地库。前端按页循环调用直至 done。
// 一次一页(200 条),避免长请求超时;ON CONFLICT DO NOTHING 不覆盖本地改动。
export async function POST(req: Request) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "未配置数据库" }, { status: 503 });
  }
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  }
  if (!(await proEnabled())) {
    return NextResponse.json(
      { error: "官方模板库是 Pro 商业版权益,请先激活 License" },
      { status: 403 }
    );
  }
  let body: { page?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const page = Math.max(1, Number(body.page) || 1);

  // 本实例的 License Key(env 优先,其次 DB —— 与 edition.ts 的 Pro 判定同源)
  const key =
    (process.env.PRO_LICENSE_KEY || "").trim() ||
    ((await getSetting("pro_license_key")) || "").trim();
  if (!key) {
    return NextResponse.json(
      { error: "未找到本实例的 License Key" },
      { status: 400 }
    );
  }

  let server = "https://ai.starzeco.com";
  try {
    server = new URL(
      process.env.LICENSE_SERVER_URL || "https://ai.starzeco.com"
    ).origin;
  } catch {
    /* 用默认 */
  }

  try {
    const r = await fetch(`${server}/api/pro/templates-export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, page, pageSize: 200 }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const d = (await r.json().catch(() => null)) as {
      templates?: Parameters<typeof importTemplates>[0];
      total?: number;
      error?: string;
    } | null;
    if (!r.ok || !d?.templates) {
      return NextResponse.json(
        { error: d?.error || "官方站拉取失败,请稍后重试" },
        { status: 502 }
      );
    }
    const total = Number(d.total) || 0;
    const offset = (page - 1) * 200;
    // 首页顺手把早期同步进来的 r2.dev 直链修成同源代理(幂等)
    if (page === 1) await rewriteTemplateImagesToProxy().catch(() => {});
    const items = d.templates.map((t) => ({
      ...t,
      image: proxifyImage(t.image),
    }));
    const imported = await importTemplates(items, total, offset);
    const done = offset + d.templates.length >= total;
    return NextResponse.json({
      ok: true,
      page,
      total,
      got: d.templates.length,
      imported,
      done,
    });
  } catch {
    return NextResponse.json(
      { error: "连接官方站超时,请稍后重试" },
      { status: 502 }
    );
  }
}
