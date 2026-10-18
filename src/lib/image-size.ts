// ---------------------------------------------------------------------------
// 输出尺寸的**唯一真源**。生图页与三个工具页(局部改图 / 印花提取 / 3D服装图)共用。
//
// **两代模型能力完全不同,别混用**(2026-08-15 实测):
//   · gpt-image-1 → 报错 "Supported sizes are 1024x1024, 1024x1536, 1536x1024"
//                   = 只有三种固定尺寸,2K/4K 只能靠后期放大。
//   · gpt-image-2 → 报错 "Width and height must both be divisible by 16"
//                   = **任意尺寸,只要宽高都是 16 的倍数** → 原生就能直出 2K/4K。
//
// 老代码是照 v1 写的,永远只请求 1024/1536 再用 sharp 插值拉到 2K/4K ——
// 那只是把像素拉大、一个细节都不增加,专业客户一眼能看出"糊、塑料感"。
// 生图页 2026-08-15 已改原生直出;**三个工具页 2026-08-26 跟上**(本文件即那次抽取)。
// ---------------------------------------------------------------------------
import { resolutionLongSide } from "@/lib/mock-data";

/** 向下对齐到 16 的倍数(gpt-image-2 硬性要求),且不小于 256。
 *  **必须向下取整**:向上取会把刚卡在像素预算边缘的尺寸顶出界,又变 400。 */
export function align16(n: number): number {
  return Math.max(256, Math.floor(n / 16) * 16);
}

// gpt-image-2 有**两条**尺寸约束,少判一条就是 400(2026-08-15 实测):
//   ① 最长边 ≤ 3840        —— 4096x4096 报 "longest edge must be ≤ 3840"
//   ② 总像素 ≤ 约 830 万    —— 3840x2160(8.29MP)通过;2880x3840(11.06MP)报
//                              "Requested resolution exceeds the current pixel budget"
// 所以「4K」不能简单理解成"长边 3840",竖版/方图会因为总像素超标被拒。
// 留 1% 安全余量,免得对齐取整后正好压线。
export const PIXEL_BUDGET = 8_290_000 * 0.99;

/** gpt-image-2:按「比例 + 分辨率档」算真实输出尺寸,同时满足上面两条约束。 */
export function nativeSize(ratio: string, longSide: number): string {
  const [rw, rh] = ratio.split(":").map(Number);
  const k = rw > 0 && rh > 0 ? rw / rh : 1;
  // 长边取档位值,短边按比例推;正方形时两边相等。
  let w = k >= 1 ? longSide : longSide * k;
  let h = k >= 1 ? longSide / k : longSide;
  // 超总像素预算 → 等比缩到预算内(保持用户选的比例,只降尺寸)。
  const px = w * h;
  if (px > PIXEL_BUDGET) {
    const s = Math.sqrt(PIXEL_BUDGET / px);
    w *= s;
    h *= s;
  }
  return `${align16(w)}x${align16(h)}`;
}

export function sizeFor(ratio: string, model: string, longSide = 0): string {
  const isV2 = model.startsWith("gpt-image-2");
  // v2 且选了 2K/4K:直接请求真实尺寸(auto 比例按 1:1 出,让长边等于档位)。
  if (isV2 && longSide > 0) {
    return nativeSize(ratio === "auto" ? "1:1" : ratio, longSide);
  }
  // OpenAI gpt-image 接受 size: "auto",让模型自选最合适的输出尺寸。
  // DALL·E 3 不支持 auto,退化成方图。
  if (ratio === "auto") return model === "dall-e-3" ? "1024x1024" : "auto";
  // 通用方向判断:任意 "w:h" 比例都能映射到 gpt-image 支持的三种尺寸(横/竖/方)。
  const [rw, rh] = ratio.split(":").map(Number);
  const k = rw > 0 && rh > 0 ? rw / rh : 1;
  const portrait = k < 0.95;
  const landscape = k > 1.05;
  if (model === "dall-e-3") {
    if (landscape) return "1792x1024";
    if (portrait) return "1024x1792";
    return "1024x1024";
  }
  if (landscape) return "1536x1024";
  if (portrait) return "1024x1536";
  return "1024x1024";
}

/**
 * 编辑类工具(局改 / 印花提取 / 3D服装图)按分辨率档要的**原生输出尺寸**。
 *
 * 返回 null = 这一档没有原生尺寸可用,调用方继续走老的固定尺寸(+ 必要时后期放大):
 *   · 模型不是 gpt-image-2(例如印花提取的透明底必须用 gpt-image-1);
 *   · 档位是 1K(1K 本来就是模型原生档,直接用 sizeFor 的固定尺寸更稳)。
 *
 * ratio 传 "w:h";不知道比例时传源图宽高(如 `${w}:${h}`),别硬塞 "auto"。
 */
export function nativeEditSize(
  ratio: string,
  resolution: string,
  model: string
): string | null {
  if (!model.startsWith("gpt-image-2")) return null;
  const long = resolutionLongSide(resolution);
  if (!long) return null;
  const r = !ratio || ratio === "auto" || ratio === "自动" ? "1:1" : ratio;
  return nativeSize(r, long);
}
