// 「哪些 app_artworks 行算用户的作品」——**唯一判定处**。
//
// 库里除了用户真正生成的图,还存了两类**素材行**(血缘树需要它们才能连起来,
// 所以不能不存,但它们不是用户的产出):
//   · 模板原图:`templateId` 非空 —— 「做同款」时建的血缘根节点,是模板自带的图;
//   · 上传图:没有提示词 —— 用户自己拖进来的底图/参考图。
//
// 2026-08-17 客户实际踩到:作品页把这两类一起列出来,客户以为是自己生成的作品,
// 点进去还会在生成页显示"参考图/引用的提示词",更困惑;而且让作品计数虚高。
//
// ⚠️ 新增列作品的地方一律用这个函数,别再各写各的 `.filter(...)` ——
// 之前 7 处各写一遍,改一处漏六处。
export type ArtworkLike = {
  image?: string | null;
  status?: string | null;
  prompt?: string | null;
  templateId?: string | null;
};

/** 是否是「用户真正生成出来的作品」(可展示、可计数)。 */
export function isUserOutput(a: ArtworkLike): boolean {
  return (
    !!a.image &&
    a.status !== "failed" &&
    !a.templateId &&
    (a.prompt ?? "").trim().length > 0
  );
}
