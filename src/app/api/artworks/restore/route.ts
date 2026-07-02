import { NextResponse } from "next/server";
import { dbEnabled, addArtworks, setArtworkPosition } from "@/lib/db";
import type { ArtworkRecord } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 撤销删除:用原始 id 把被删的作品重新插回(图片仍在存储里,所以 URL 有效)。
// email 限定,沿用本站信任模式。
export async function POST(request: Request) {
  if (!dbEnabled)
    return NextResponse.json({ error: "未启用存储" }, { status: 400 });
  let body: {
    email?: string;
    records?: (Omit<ArtworkRecord, "createdAt"> & {
      canvasX?: number | null;
      canvasY?: number | null;
    })[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const records = Array.isArray(body.records) ? body.records.slice(0, 200) : [];
  if (!email || records.length === 0) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  try {
    await addArtworks(
      email,
      records.map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        prompt: r.prompt,
        status: r.status || "completed",
        image: r.image,
        gradient: r.gradient,
        style: r.style ?? null,
        ratio: r.ratio ?? null,
        resolution: r.resolution ?? null,
        source: r.source ?? null,
        batchId: r.batchId ?? null,
        parentId: r.parentId ?? null,
        parentIds: r.parentIds ?? [],
        templateId: r.templateId ?? null,
        groupId: r.groupId ?? null, // 保留原项目分组
      }))
    );
    // 恢复画布坐标
    for (const r of records) {
      if (Number.isFinite(r.canvasX) && Number.isFinite(r.canvasY)) {
        await setArtworkPosition(
          email,
          r.id,
          r.canvasX as number,
          r.canvasY as number
        ).catch(() => {});
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
