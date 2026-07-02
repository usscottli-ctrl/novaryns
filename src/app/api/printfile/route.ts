import { NextResponse } from "next/server";
import {
  dbEnabled,
  reserveCredits,
  refundCredits,
  addArtworks,
  getUser,
  isBanned,
  addLedgerEntry,
} from "@/lib/db";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { bearer, emailFromToken } from "@/lib/supabase-admin";
import { storageEnabled, uploadImage } from "@/lib/storage";
import { safeError } from "@/lib/api-error";

// ---------------------------------------------------------------------------
// 印刷图专用端点。
//
// 把上传图按指定 DPI + 物理尺寸(毫米)重采样成符合印刷标准的高清文件,并写入
// DPI 元数据(density),让印刷厂/排版软件正确识别成品尺寸。适配海报/画册/包装。
// 纯本地 sharp 处理,不调用任何 AI 模型,故计费极低(1 积分/张)。
// 落库 category="printfile"。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 60;

// 纯本地 sharp 处理、零 API 成本,定价做成免费(0),作为引流工具 —— 比同行更低。
// (积分系统为整数列,无法表示 0.3;免费是更干净且更低的等价方案。)
const PRINTFILE_COST = 0;
const MM_PER_INCH = 25.4;
// 单边像素上限,防超大尺寸把内存打爆(8000px ≈ 67cm@300dpi,够海报)。
const MAX_PX = 8000;

type Fit = "contain" | "cover";

type PrintInput = {
  bytes: Buffer;
  srcType: string; // 上传原图的 MIME(用于原图存档命名)
  email: string;
  title: string;
  dpi: number;
  wMm: number;
  hMm: number;
  fit: Fit;
  bg: "white" | "transparent";
};

function clampDpi(n: number): number {
  if (!Number.isFinite(n)) return 300;
  return Math.min(1200, Math.max(72, Math.round(n)));
}
function clampMm(n: number, fallback: number): number {
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(2000, Math.max(10, n));
}

async function parseInput(request: Request): Promise<PrintInput | null> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return null;
  const f = await request.formData();
  const s = (k: string) => (f.get(k) ?? "").toString();

  const file = f.get("image");
  if (!(file instanceof File && file.size > 0)) return null;
  const fitRaw = s("fit");
  return {
    bytes: Buffer.from(await file.arrayBuffer()),
    srcType: file.type || "image/png",
    email: s("email").trim(),
    title: s("title").trim() || "印刷图",
    dpi: clampDpi(Number(s("dpi")) || 300),
    wMm: clampMm(Number(s("wMm")), 210),
    hMm: clampMm(Number(s("hMm")), 297),
    fit: fitRaw === "cover" ? "cover" : "contain",
    bg: s("bg") === "transparent" ? "transparent" : "white",
  };
}

export async function POST(request: Request) {
  let input: PrintInput | null;
  try {
    input = await parseInput(request);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!input) {
    return NextResponse.json({ error: "缺少图片" }, { status: 400 });
  }
  if (input.bytes.length > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "图片过大(请 < 20MB)" }, { status: 400 });
  }

  try {
    const ip = clientIp(request);
    if (!rateLimit(`printfile:${ip}`, 60, 600_000)) {
      return NextResponse.json(
        { error: "请求过于频繁,请稍后再试" },
        { status: 429 }
      );
    }

    if (dbEnabled) {
      const tokenEmail = await emailFromToken(bearer(request));
      if (!tokenEmail) {
        return NextResponse.json({ error: "请先登录后再操作" }, { status: 401 });
      }
      input.email = tokenEmail;
    }
    const useDb = dbEnabled && input.email.length > 0;
    const cost = PRINTFILE_COST;

    if (dbEnabled && (await isBanned(input.email, ip))) {
      return NextResponse.json({ error: "账号或 IP 已被封禁" }, { status: 403 });
    }

    if (useDb && cost > 0) {
      const ok = await reserveCredits(input.email, cost);
      if (!ok) {
        return NextResponse.json(
          { error: "积分不足,请充值后重试" },
          { status: 402 }
        );
      }
    }

    // 目标像素 = 毫米 / 25.4 * DPI
    let wPx = Math.round((input.wMm / MM_PER_INCH) * input.dpi);
    let hPx = Math.round((input.hMm / MM_PER_INCH) * input.dpi);
    const over = Math.max(wPx / MAX_PX, hPx / MAX_PX, 1);
    if (over > 1) {
      wPx = Math.round(wPx / over);
      hPx = Math.round(hPx / over);
    }

    let out: Buffer;
    try {
      const mod = (await import("sharp")) as unknown as {
        default?: typeof import("sharp");
      } & typeof import("sharp");
      const sharp = mod.default ?? mod;
      out = await sharp(input.bytes)
        .rotate()
        .resize(wPx, hPx, {
          fit: input.fit, // contain=完整留白 / cover=填满裁切
          kernel: "lanczos3", // 高质量重采样
          background:
            input.bg === "transparent"
              ? { r: 0, g: 0, b: 0, alpha: 0 }
              : { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .withMetadata({ density: input.dpi }) // 写入 DPI 元数据
        .png()
        .toBuffer();
    } catch (e) {
      if (useDb && cost > 0)
        await refundCredits(input.email, cost).catch(() => {});
      throw e;
    }

    const id = `prt-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    let url = `data:image/png;base64,${out.toString("base64")}`;
    if (storageEnabled) {
      try {
        url = await uploadImage(
          new Uint8Array(out),
          "image/png",
          `printfiles/${id}.png`
        );
      } catch (e) {
        console.error(
          "[printfile] R2 upload failed, returning inline:",
          e instanceof Error ? e.message : e
        );
      }
    }

    // 输入原图也存一份(供作品记录「原图 / 成品对比」;失败不阻断主流程)。
    let srcUrl: string | null = null;
    if (storageEnabled) {
      try {
        const srcType = input.srcType || "image/png";
        const sext = srcType.includes("png")
          ? "png"
          : srcType.includes("webp")
            ? "webp"
            : "jpg";
        srcUrl = await uploadImage(
          new Uint8Array(input.bytes),
          srcType,
          `printfiles/src-${id}.${sext}`
        );
      } catch {
        /* 原图存档失败,忽略 */
      }
    }

    const specLabel = `${input.wMm}×${input.hMm}mm · ${input.dpi}dpi`;

    let user: Awaited<ReturnType<typeof getUser>> = null;
    if (useDb) {
      try {
        await addArtworks(
          input.email,
          [
            {
              id,
              title: input.title,
              category: "printfile",
              prompt: specLabel,
              status: "completed",
              image: url,
              gradient: "from-slate-100 to-zinc-100",
              style: null,
              ratio: null,
              resolution: `${wPx}×${hPx}`,
              source: srcUrl,
              parentId: null,
              parentIds: [],
            },
          ],
          `prt-${Date.now()}`
        );
      } catch (e) {
        console.error(
          "[printfile] addArtworks failed:",
          e instanceof Error ? e.message : e
        );
      }
      if (cost > 0) {
        await addLedgerEntry(input.email, -cost, "印刷图").catch(() => {});
      }
      user = await getUser(input.email).catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      id,
      url,
      px: { w: wPx, h: hPx },
      spec: specLabel,
      creditsUsed: useDb ? cost : 0,
      user,
    });
  } catch (e) {
    return NextResponse.json(
      { error: safeError(e, "印刷图服务暂时不可用,请稍后重试") },
      { status: 500 }
    );
  }
}
