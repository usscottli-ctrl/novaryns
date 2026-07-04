import { NextResponse } from "next/server";
import {
  dbEnabled,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { storageEnabled, uploadImage } from "@/lib/storage";

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

/** GET — full list for the admin UI (same data as public /api/templates,
 *  but gated so admins always get the latest authoritative copy). */
export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  try {
    const templates = await listTemplates();
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取失败" },
      { status: 500 }
    );
  }
}

type Patch = {
  title?: string;
  category?: string;
  industry?: string;
  description?: string;
  prompt?: string;
  tags?: string[];
  image?: string;
  gradient?: string;
  popular?: boolean;
  homepageFeatured?: boolean;
};

function parseTags(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export async function PATCH(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;

  const ct = req.headers.get("content-type") ?? "";
  let id = "";
  const patch: Patch = {};

  try {
    if (ct.includes("multipart/form-data")) {
      const f = await req.formData();
      id = (f.get("id") ?? "").toString().trim();

      const fields: Array<keyof Patch> = [
        "title",
        "category",
        "industry",
        "description",
        "prompt",
        "gradient",
      ];
      for (const k of fields) {
        const v = f.get(k);
        if (v !== null) (patch[k] as string) = v.toString();
      }
      if (f.get("tags") !== null) {
        patch.tags = parseTags(f.get("tags")!.toString());
      }
      if (f.get("popular") !== null) {
        patch.popular =
          f.get("popular")!.toString().toLowerCase() === "true";
      }
      if (f.get("homepageFeatured") !== null) {
        patch.homepageFeatured =
          f.get("homepageFeatured")!.toString().toLowerCase() === "true";
      }

      const file = f.get("image");
      if (file && file instanceof File && file.size > 0) {
        if (!storageEnabled) {
          return NextResponse.json(
            { error: "R2 存储未配置，无法上传图片" },
            { status: 503 }
          );
        }
        if (file.size > 8 * 1024 * 1024) {
          return NextResponse.json(
            { error: "图片过大（请 < 8MB）" },
            { status: 400 }
          );
        }
        const buf = Buffer.from(await file.arrayBuffer());
        const ext = (file.type || "image/png").split("/")[1] || "png";
        const key = `templates/${id}-${Date.now()}.${ext}`;
        const url = await uploadImage(
          new Uint8Array(buf),
          file.type || "image/png",
          key
        );
        patch.image = url;
      }
    } else {
      const body = (await req.json()) as Patch & { id?: string };
      id = (body.id ?? "").trim();
      const allowed: Array<keyof Patch> = [
        "title",
        "category",
        "industry",
        "description",
        "prompt",
        "gradient",
        "image",
        "tags",
        "popular",
        "homepageFeatured",
      ];
      for (const k of allowed) {
        if (body[k] !== undefined) (patch[k] as unknown) = body[k];
      }
    }
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  if (!id) {
    return NextResponse.json({ error: "缺少模板 id" }, { status: 400 });
  }

  try {
    const exists = await getTemplate(id);
    if (!exists) {
      return NextResponse.json(
        { error: `模板 ${id} 不存在` },
        { status: 404 }
      );
    }
    const updated = await updateTemplate(id, patch);
    return NextResponse.json({ template: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新失败" },
      { status: 500 }
    );
  }
}
