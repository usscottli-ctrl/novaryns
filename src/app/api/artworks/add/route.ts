import { NextResponse } from "next/server";
import { dbEnabled, addArtworks, setArtworkPosition } from "@/lib/db";
import { uploadImage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRADIENTS = [
  "from-rose-100 to-slate-100",
  "from-emerald-100 to-teal-100",
  "from-sky-100 to-indigo-100",
  "from-amber-100 to-orange-100",
];

function newId() {
  return `art-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// 新增作品(画布用):
//  - multipart(含 image 文件)= 上传图片作新节点(默认根节点,或挂 parentId)
//  - json {src} = 创建副本 / 复制粘贴节点(复制源图与血缘)
// email 限定,沿用本站信任模式。
export async function POST(request: Request) {
  if (!dbEnabled)
    return NextResponse.json({ error: "未启用存储" }, { status: 400 });

  const ctype = request.headers.get("content-type") || "";

  // ── 上传图片作节点 ──
  if (ctype.includes("multipart/form-data")) {
    let fd: FormData;
    try {
      fd = await request.formData();
    } catch {
      return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
    }
    const email = String(fd.get("email") ?? "").trim();
    const parentId = String(fd.get("parentId") ?? "").trim() || null;
    const title = String(fd.get("title") ?? "").trim() || "上传图片";
    // linked=1(拉线建的)→ 画连线(source≠canvas-add);否则独立无线
    const linked = String(fd.get("linked") ?? "") === "1";
    const px = Number(fd.get("x"));
    const py = Number(fd.get("y"));
    const file = fd.get("image");
    if (!email || !(file instanceof File)) {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }
    if (file.size > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "图片过大(≤12MB)" }, { status: 400 });
    }
    const id = newId();
    const buf = new Uint8Array(await file.arrayBuffer());
    const type = file.type || "image/png";
    const ext = type.includes("png")
      ? "png"
      : type.includes("webp")
        ? "webp"
        : "jpg";
    let url: string;
    try {
      url = await uploadImage(buf, type, `canvas-uploads/${id}.${ext}`);
    } catch {
      return NextResponse.json({ error: "上传失败" }, { status: 500 });
    }
    try {
      await addArtworks(email, [
        {
          id,
          title,
          category: "main",
          prompt: "",
          status: "completed",
          image: url,
          gradient: GRADIENTS[0],
          parentId,
          source: linked ? "upload" : "canvas-add",
        },
      ]);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 }
      );
    }
    if (Number.isFinite(px) && Number.isFinite(py)) {
      await setArtworkPosition(email, id, px, py).catch(() => {});
    }
    return NextResponse.json({ ok: true, id, image: url });
  }

  // ── 创建副本 / 粘贴节点 ──
  let body: {
    email?: string;
    parentId?: string | null; // 顶层覆盖:落到当前项目某父节点下
    linked?: boolean; // true=画连线(衍生);false/缺省=独立节点(canvas-add,不连线)
    x?: number;
    y?: number;
    src?: {
      image?: string;
      title?: string;
      category?: string;
      prompt?: string;
      style?: string;
      ratio?: string;
      resolution?: string;
      parentId?: string | null;
      templateId?: string | null;
    };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const src = body.src;
  if (!email || !src || !src.image) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  const id = newId();
  // 顶层 parentId(从历史加到当前项目)优先于 src.parentId(纯副本)
  const parentId =
    body.parentId !== undefined ? body.parentId : (src.parentId ?? null);
  try {
    await addArtworks(email, [
      {
        id,
        title: src.title || "作品",
        category: src.category || "main",
        prompt: src.prompt || "",
        status: "completed",
        image: src.image,
        gradient: GRADIENTS[1],
        style: src.style,
        ratio: src.ratio,
        resolution: src.resolution,
        parentId,
        templateId: src.templateId ?? null,
        // linked → 非 canvas-add(画布会画连线);否则独立节点
        source: body.linked ? "derived" : "canvas-add",
      },
    ]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
  const bx = Number(body.x);
  const by = Number(body.y);
  if (Number.isFinite(bx) && Number.isFinite(by)) {
    await setArtworkPosition(email, id, bx, by).catch(() => {});
  }
  return NextResponse.json({ ok: true, id, image: src.image });
}
