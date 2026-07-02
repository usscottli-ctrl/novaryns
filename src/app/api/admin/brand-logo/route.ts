import { NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { isAdminToken, bearer } from "@/lib/supabase-admin";
import { storageEnabled, uploadImage } from "@/lib/storage";
import { proEnabled } from "@/lib/edition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// 品牌 Logo 上传(Pro 白标)。管理员上传图片 → 压到合适尺寸(保持比例、保留透明底、
// 不放大)→ 存对象存储(R2 / 本地自适应,见 storage.ts)→ 返回 URL。
// 前端把返回的 url 落进设置项 brand_logo(与手填 URL 同一个值)。仅管理员可调。
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  if (!dbEnabled)
    return NextResponse.json({ error: "未配置数据库" }, { status: 503 });
  if (!(await isAdminToken(bearer(req))))
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  if (!(await proEnabled()))
    return NextResponse.json({ error: "该功能为 Pro 版功能" }, { status: 403 });
  if (!storageEnabled)
    return NextResponse.json({ error: "未配置对象存储,无法上传" }, { status: 503 });

  try {
    const f = await req.formData();
    const file = f.get("image");
    if (!(file instanceof File && file.size > 0))
      return NextResponse.json({ error: "请上传图片" }, { status: 400 });
    if (!file.type.startsWith("image/"))
      return NextResponse.json({ error: "请上传图片文件" }, { status: 400 });
    if (file.size > 2 * 1024 * 1024)
      return NextResponse.json({ error: "图片过大(建议 < 2MB)" }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

    // 压到合适尺寸:宽 ≤ 640 / 高 ≤ 320,保持比例、保留透明底、不放大 → PNG。
    // sharp 失败(极少数环境)→ 回退直接存原文件。
    let out = bytes;
    let contentType = file.type || "image/png";
    let ext = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
    try {
      const mod = (await import("sharp")) as unknown as {
        default?: typeof import("sharp");
      } & typeof import("sharp");
      const sharp = mod.default ?? mod;
      const png = await sharp(Buffer.from(bytes))
        .resize(640, 320, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      out = new Uint8Array(png);
      contentType = "image/png";
      ext = "png";
    } catch {
      /* 回退存原图 */
    }

    const url = await uploadImage(out, contentType, `brand/logo-${id}.${ext}`);
    return NextResponse.json({ ok: true, url });
  } catch {
    // 净化:不外泄底层错误。
    return NextResponse.json({ error: "上传失败,请重试" }, { status: 500 });
  }
}
