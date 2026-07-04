import { NextResponse } from "next/server";
import {
  dbEnabled,
  listAllArtworks,
  getArtworkById,
  createTemplate,
  deleteArtwork,
  importedArtworkIds,
  setUserBanned,
  bannedEmailsAmong,
} from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { CATEGORY_LABELS, type Category } from "@/lib/mock-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function guard(req: Request): Promise<NextResponse | null> {
  if (!dbEnabled) {
    return NextResponse.json(
      { error: "未配置数据库，管理不可用" },
      { status: 503 }
    );
  }
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  }
  return null;
}

const PAGE_SIZE = 24;

/** GET — paginated list of every user's artworks (newest first). */
export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const sp = new URL(req.url).searchParams;
  const page = Math.max(0, Math.trunc(Number(sp.get("page")) || 0));
  const pageSize = Math.min(
    Math.max(Math.trunc(Number(sp.get("pageSize")) || PAGE_SIZE), 1),
    100
  );
  try {
    const { artworks, total } = await listAllArtworks(
      pageSize,
      page * pageSize
    );
    const [importedIds, bannedEmails] = await Promise.all([
      importedArtworkIds(artworks.map((a) => a.id)),
      bannedEmailsAmong(artworks.map((a) => a.email)),
    ]);
    return NextResponse.json({
      artworks,
      total,
      page,
      pageSize,
      importedIds,
      bannedEmails,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取失败" },
      { status: 500 }
    );
  }
}

// Map the artwork's stored category (an internal key like "main", or already a
// Chinese label) to the template library's Chinese category label.
function categoryLabel(raw: string): string {
  if (raw in CATEGORY_LABELS) return CATEGORY_LABELS[raw as Category];
  return raw || "其他用例";
}

function makeDescription(prompt: string): string {
  return prompt.length > 110 ? prompt.slice(0, 110).trimEnd() + "…" : prompt;
}

/** POST — artwork actions for the admin "全部作品" view.
 *  body.action:
 *   - "import"   { artworkId, title?, category? } -> add to template library
 *   - "delete"   { artworkId }                    -> delete the artwork
 *   - "ban-user" { email }                         -> ban the owner */
export async function POST(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;

  let body: {
    action?: string;
    artworkId?: string;
    title?: string;
    category?: string;
    email?: string;
    banned?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  try {
    if (body.action === "import") {
      const artworkId = (body.artworkId ?? "").trim();
      if (!artworkId) {
        return NextResponse.json({ error: "缺少 artworkId" }, { status: 400 });
      }
      const art = await getArtworkById(artworkId);
      if (!art) {
        return NextResponse.json({ error: "作品不存在" }, { status: 404 });
      }
      // Template covers must be real hosted URLs (artwork images live on R2).
      if (!/^https?:\/\//.test(art.image)) {
        return NextResponse.json(
          { error: "该作品没有可用的图片地址，无法导入" },
          { status: 400 }
        );
      }
      // 白底原图:把原作品当初上传的产品图(source_url)带进模板,做同款时载入产品图。
      // 只接受真实图片 URL;类型标记(upload/derived 等)或空则不带。
      const sourceImage =
        art.source && /^https?:\/\//.test(art.source) ? art.source : "";
      const { template, created } = await createTemplate({
        id: `tpl-art-${artworkId}`, // deterministic -> re-import 刷新而非重复
        title: (body.title ?? "").trim() || art.title || "用户作品",
        category: (body.category ?? "").trim() || categoryLabel(art.category),
        industry: "用户作品",
        description: makeDescription(art.prompt),
        prompt: art.prompt,
        tags: [],
        image: art.image,
        gradient: art.gradient || "from-emerald-100 to-teal-100",
        popular: false,
        sourceImage,
      });
      return NextResponse.json({ ok: true, created, template });
    }

    if (body.action === "delete") {
      const artworkId = (body.artworkId ?? "").trim();
      if (!artworkId) {
        return NextResponse.json({ error: "缺少 artworkId" }, { status: 400 });
      }
      const ok = await deleteArtwork(artworkId);
      return NextResponse.json({ ok });
    }

    if (body.action === "ban-user") {
      const email = (body.email ?? "").trim().toLowerCase();
      if (!email) {
        return NextResponse.json({ error: "缺少 email" }, { status: 400 });
      }
      const banned = body.banned === true;
      await setUserBanned(email, banned);
      return NextResponse.json({ ok: true, banned });
    }

    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "操作失败" },
      { status: 500 }
    );
  }
}
