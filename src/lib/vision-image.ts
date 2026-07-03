import "server-only";

// 把用户上传的图压成"适合视觉模型理解"的小图(长边 1024 + JPEG q80),返回 data URL。
//
// 为什么:所有"看图理解"功能(AI 帮写、侵权检测、标题生成、套图规划)都是把图发给
// gpt-4o-mini 视觉模型让它"看懂内容"输出文字——理解内容**不需要高清**。直接发原图
// (可达 8-12MB)会让 vision 调用慢、payload 巨大,一旦经过网关(如 Cloudflare 100s)
// 就超时→返回非 JSON→前端 res.json() 崩→显示"网络错误"。压到 1024/JPEG 后 payload
// 从几 MB 降到几十 KB,调用快几十倍。
//
// 注意:仅用于"看图输出文字"的场景。图生图/编辑(images.edit)需要保留清晰度,不要用此函数。
// sharp 不可用(极少见)则退回原图,不阻断。
export async function toVisionDataUrl(
  raw: Buffer,
  fallbackType = "image/png"
): Promise<string> {
  try {
    const mod = (await import("sharp")) as unknown as {
      default?: typeof import("sharp");
    } & typeof import("sharp");
    const sharp = mod.default ?? mod;
    const small = await sharp(raw)
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${small.toString("base64")}`;
  } catch {
    return `data:${fallbackType};base64,${raw.toString("base64")}`;
  }
}
