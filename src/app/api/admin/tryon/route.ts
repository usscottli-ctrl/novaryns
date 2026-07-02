import { NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { isAdminToken, bearer } from "@/lib/supabase-admin";
import { storageEnabled, uploadImage, deleteImageByUrl } from "@/lib/storage";
import { getTryonLibrary, setTryonLibrary } from "@/lib/tryon-store";
import type {
  TryonModel,
  TryonScene,
  ModelGroup,
  Gender,
  SceneEnv,
} from "@/lib/tryon-library";
import { MODEL_GROUPS, SCENE_ENVS } from "@/lib/tryon-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: Request): Promise<NextResponse | null> {
  if (!dbEnabled)
    return NextResponse.json({ error: "未配置数据库" }, { status: 503 });
  if (!(await isAdminToken(bearer(req))))
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  return null;
}

export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  return NextResponse.json(await getTryonLibrary());
}

export async function POST(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;

  const ct = req.headers.get("content-type") || "";
  try {
    // ---- 新增(上传图片)：multipart ----
    if (ct.includes("multipart/form-data")) {
      if (!storageEnabled)
        return NextResponse.json({ error: "未配置对象存储" }, { status: 503 });
      const f = await req.formData();
      const kind = (f.get("kind") ?? "").toString();
      const name = (f.get("name") ?? "").toString().trim().slice(0, 40);
      const file = f.get("image");
      if (!name) return NextResponse.json({ error: "请填写名称" }, { status: 400 });
      if (!(file instanceof File && file.size > 0))
        return NextResponse.json({ error: "请上传图片" }, { status: 400 });
      if (file.size > 15 * 1024 * 1024)
        return NextResponse.json({ error: "图片过大(<15MB)" }, { status: 400 });

      const id = `adm-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const lib = await getTryonLibrary();

      const loadSharp = async () => {
        const mod = (await import("sharp")) as unknown as {
          default?: typeof import("sharp");
        } & typeof import("sharp");
        return mod.default ?? mod;
      };

      // 生成缩略图(弹窗网格显示用,小而快);失败则回退用原图
      const makeThumb = async (kind2: "models" | "scenes", upperBody: boolean) => {
        try {
          const sharp = await loadSharp();
          const img = upperBody
            ? sharp(Buffer.from(bytes)).resize(400, 533, { fit: "cover", position: "top" })
            : sharp(Buffer.from(bytes)).resize(400, 600, { fit: "cover", position: "attention" });
          const webp = await img.webp({ quality: 72 }).toBuffer();
          return await uploadImage(new Uint8Array(webp), "image/webp", `library/${kind2}/${id}_t.webp`);
        } catch {
          return undefined;
        }
      };

      // 生成中图(放大预览用,~800px 宽,清晰且远小于原图);失败则回退缩略图/原图
      const makeMedium = async (kind2: "models" | "scenes") => {
        try {
          const sharp = await loadSharp();
          const webp = await sharp(Buffer.from(bytes))
            .resize(800, 800, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
          return await uploadImage(new Uint8Array(webp), "image/webp", `library/${kind2}/${id}_m.webp`);
        } catch {
          return undefined;
        }
      };

      if (kind === "model") {
        const group = (f.get("group") ?? "").toString() as ModelGroup;
        const gender = (f.get("gender") ?? "").toString() as Gender;
        if (!MODEL_GROUPS.includes(group) || !["f", "m"].includes(gender))
          return NextResponse.json({ error: "分组/性别无效" }, { status: 400 });
        const url = await uploadImage(bytes, "image/png", `library/models/${id}.png`);
        const thumb = await makeThumb("models", true);
        const medium = await makeMedium("models");
        const item: TryonModel = { id, name, group, gender, url, thumb, medium, source: "admin" };
        lib.models = [item, ...lib.models]; // 新增放最前
        await setTryonLibrary(lib);
        return NextResponse.json({ ok: true, item });
      } else if (kind === "scene") {
        const env = (f.get("env") ?? "").toString() as SceneEnv;
        if (!SCENE_ENVS.includes(env))
          return NextResponse.json({ error: "环境分类无效" }, { status: 400 });
        const url = await uploadImage(bytes, "image/png", `library/scenes/${id}.png`);
        const thumb = await makeThumb("scenes", false);
        const medium = await makeMedium("scenes");
        const item: TryonScene = { id, name, env, url, thumb, medium, source: "admin" };
        lib.scenes = [item, ...lib.scenes];
        await setTryonLibrary(lib);
        return NextResponse.json({ ok: true, item });
      }
      return NextResponse.json({ error: "kind 无效" }, { status: 400 });
    }

    // ---- 排序 / 删除：JSON ----
    const body = (await req.json()) as {
      action?: string;
      kind?: string;
      ids?: string[];
      id?: string;
    };
    const lib = await getTryonLibrary();

    if (body.action === "reorder" && Array.isArray(body.ids)) {
      const order = new Map(body.ids.map((id, i) => [id, i]));
      const sortFn = <T extends { id: string }>(a: T, b: T) =>
        (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9);
      if (body.kind === "model") lib.models = [...lib.models].sort(sortFn);
      else if (body.kind === "scene") lib.scenes = [...lib.scenes].sort(sortFn);
      await setTryonLibrary(lib);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete" && body.id) {
      if (body.kind === "model") {
        const it = lib.models.find((x) => x.id === body.id);
        lib.models = lib.models.filter((x) => x.id !== body.id);
        if (it?.source === "admin") await deleteImageByUrl(it.url).catch(() => {});
      } else if (body.kind === "scene") {
        const it = lib.scenes.find((x) => x.id === body.id);
        lib.scenes = lib.scenes.filter((x) => x.id !== body.id);
        if (it?.source === "admin") await deleteImageByUrl(it.url).catch(() => {});
      }
      await setTryonLibrary(lib);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "action 无效" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "操作失败" },
      { status: 500 }
    );
  }
}
