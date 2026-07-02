// 服装上身:模特库 + 场景库「默认数据 + 类型」。素材为我方用 gpt-image-2 自生成、存共享 R2。
// 运行时真实库走 DB(app_settings.tryon_library,可被后台增删改/排序);DB 为空时回退到这里的默认集。
// 本文件**纯数据 + 类型**(无 server-only 依赖),前端/后端都可 import。

const BASE = "https://pub-d4d9c8471e8d4d94b159b20f7fbdb7d7.r2.dev/library";

export type ModelGroup = "cn" | "jp" | "kr" | "intl";
export type Gender = "f" | "m";
export type TryonModel = {
  id: string;
  name: string;
  group: ModelGroup;
  gender: Gender;
  url: string;
  /** 缩略图(弹窗网格显示用,小而快);生成仍用 url 原图 */
  thumb?: string;
  /** 中图(放大预览用,~800px 清晰但比原图小);生成仍用 url 原图 */
  medium?: string;
  /** admin=后台上传;seed=内置默认 */
  source?: "admin" | "seed";
};

export type SceneEnv = "室内" | "户外" | "街景" | "影棚" | "度假";
export type TryonScene = {
  id: string;
  name: string;
  env: SceneEnv;
  url: string;
  thumb?: string;
  medium?: string;
  source?: "admin" | "seed";
};

export const MODEL_GROUP_LABELS: Record<ModelGroup, { zh: string; en: string }> = {
  cn: { zh: "中国", en: "China" },
  jp: { zh: "日本", en: "Japan" },
  kr: { zh: "韩国", en: "Korea" },
  intl: { zh: "其他", en: "Intl" },
};

export const SCENE_ENVS: SceneEnv[] = ["室内", "户外", "街景", "影棚", "度假"];
export const MODEL_GROUPS: ModelGroup[] = ["cn", "jp", "kr", "intl"];

// 确定性 R2 key:原图 library/{models,scenes}/<id>.png;缩略图 <id>_t.webp(弹窗显示用)。
export const modelUrl = (id: string) => `${BASE}/models/${id}.png`;
export const sceneUrl = (id: string) => `${BASE}/scenes/${id}.png`;
export const modelThumb = (id: string) => `${BASE}/models/${id}_t.webp`;
export const sceneThumb = (id: string) => `${BASE}/scenes/${id}_t.webp`;
export const modelMedium = (id: string) => `${BASE}/models/${id}_m.webp`;
export const sceneMedium = (id: string) => `${BASE}/scenes/${id}_m.webp`;

const m = (id: string, name: string, group: ModelGroup, gender: Gender): TryonModel => ({
  id,
  name,
  group,
  gender,
  url: modelUrl(id),
  thumb: modelThumb(id),
  medium: modelMedium(id),
  source: "seed",
});
const s = (id: string, name: string, env: SceneEnv): TryonScene => ({
  id,
  name,
  env,
  url: sceneUrl(id),
  thumb: sceneThumb(id),
  medium: sceneMedium(id),
  source: "seed",
});

export const TRYON_MODELS: TryonModel[] = [
  // 星泽定制
  m("star1", "苏晚棠", "cn", "f"),
  // 中国(18)
  m("f1", "林晚晴", "cn", "f"),
  m("f2", "苏念", "cn", "f"),
  m("f3", "顾听澜", "cn", "f"),
  m("f4", "周禾", "cn", "f"),
  m("cn-f1", "苏沐", "cn", "f"),
  m("cn-f2", "林清霜", "cn", "f"),
  m("cn-f3", "顾盼", "cn", "f"),
  m("ea-f5", "沈知意", "cn", "f"),
  m("ea-f6", "唐糖", "cn", "f"),
  m("ea-f7", "小满", "cn", "f"),
  m("m1", "陈屿", "cn", "m"),
  m("m2", "许之衡", "cn", "m"),
  m("m3", "吴桉", "cn", "m"),
  m("m4", "梁朝", "cn", "m"),
  m("cn-m1", "沈砚", "cn", "m"),
  m("cn-m2", "程屹", "cn", "m"),
  m("cn-m3", "陆鸣", "cn", "m"),
  m("ea-m5", "韩劲", "cn", "m"),
  // 日本(7)
  m("jp-f1", "佐藤美咲", "jp", "f"),
  m("jp-f2", "铃木遥", "jp", "f"),
  m("jp-f3", "高桥结衣", "jp", "f"),
  m("jp-f4", "田中花音", "jp", "f"),
  m("jp-m1", "山田凉介", "jp", "m"),
  m("jp-m2", "伊藤大和", "jp", "m"),
  m("jp-m3", "渡边翔太", "jp", "m"),
  // 韩国(7)
  m("kr-f1", "金敏书", "kr", "f"),
  m("kr-f2", "朴秀妍", "kr", "f"),
  m("kr-f3", "李知恩", "kr", "f"),
  m("kr-f4", "崔宥真", "kr", "f"),
  m("kr-m1", "姜敏赫", "kr", "m"),
  m("kr-m2", "韩道允", "kr", "m"),
  m("kr-m3", "林宰范", "kr", "m"),
  // 其他人种(18)
  m("se-f1", "Maya", "intl", "f"),
  m("se-m1", "Arto", "intl", "m"),
  m("sa-f1", "Priya", "intl", "f"),
  m("sa-f2", "Anaya", "intl", "f"),
  m("sa-m1", "Rohan", "intl", "m"),
  m("eu-f1", "Emma", "intl", "f"),
  m("eu-f2", "Sofia", "intl", "f"),
  m("eu-f3", "Claire", "intl", "f"),
  m("eu-m1", "Liam", "intl", "m"),
  m("af-f1", "Amara", "intl", "f"),
  m("af-f2", "Zola", "intl", "f"),
  m("af-m1", "Kwame", "intl", "m"),
  m("la-f1", "Lucia", "intl", "f"),
  m("la-m1", "Mateo", "intl", "m"),
  m("me-f1", "Layla", "intl", "f"),
  m("me-m1", "Omar", "intl", "m"),
  m("mix-f1", "Nina", "intl", "f"),
  m("mix-m1", "Kai", "intl", "m"),
];

export const TRYON_SCENES: TryonScene[] = [
  s("s1", "室内灰调商务", "室内"),
  s("s2", "花园清新", "户外"),
  s("s3", "夜市潮流", "街景"),
  s("s4", "咖啡外摆", "户外"),
  s("s5", "黑白极简", "影棚"),
  s("s6", "泳池度假", "度假"),
  s("s7", "城市街拍", "街景"),
  s("s8", "居家温馨", "室内"),
  s("s9", "ins风卧室", "室内"),
  s("s10", "复古胶片街景", "街景"),
  s("s11b", "海边日落", "度假"),
  s("s12", "雪景街拍", "街景"),
  s("s13", "商场橱窗", "室内"),
  s("s14", "屋顶天台", "户外"),
];

export function findModel(id: string, list: TryonModel[] = TRYON_MODELS) {
  return list.find((x) => x.id === id);
}
export function findScene(id: string, list: TryonScene[] = TRYON_SCENES) {
  return list.find((x) => x.id === id);
}
