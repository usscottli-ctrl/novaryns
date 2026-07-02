import "server-only";
import { dbEnabled, getSetting, setSetting } from "@/lib/db";
import {
  TRYON_MODELS,
  TRYON_SCENES,
  type TryonModel,
  type TryonScene,
} from "@/lib/tryon-library";

// 服装上身素材库的运行时真源:存 app_settings.tryon_library(JSON),后台可增删改/排序。
// DB 为空(从未编辑过)时回退到 tryon-library.ts 的内置默认集。

const KEY = "tryon_library";

export type TryonLibrary = { models: TryonModel[]; scenes: TryonScene[] };

export async function getTryonLibrary(): Promise<TryonLibrary> {
  if (dbEnabled) {
    try {
      const raw = await getSetting(KEY);
      if (raw) {
        const p = JSON.parse(raw) as TryonLibrary;
        if (Array.isArray(p?.models) && Array.isArray(p?.scenes)) return p;
      }
    } catch {
      /* 解析失败 → 用默认 */
    }
  }
  return { models: TRYON_MODELS, scenes: TRYON_SCENES };
}

export async function setTryonLibrary(lib: TryonLibrary): Promise<void> {
  await setSetting(KEY, JSON.stringify(lib));
}
