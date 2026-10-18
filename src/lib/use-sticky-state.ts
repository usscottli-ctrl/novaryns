"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// 「记住上次的选择」—— 各功能页的参数(模型/质量/分辨率/比例/数量…)用它,
// 用户下次进来直接是上次的配置,不用每次重选。
//
// 两个必须处理的坑:
//  ① **SSR 水合**:服务端没有 localStorage。若首渲染就读会造成
//     服务端/客户端 HTML 不一致 → React 报 hydration mismatch。
//     所以首渲染一律用默认值,挂载后(useEffect)再补上存的值。
//  ② **存的值可能已失效**:模型下架、某模型不再支持 4K、档位改名……
//     直接用会让用户卡在一个非法状态。所以支持传 validate,
//     校验不过就丢弃回默认值。
//
// 存 localStorage 而不是服务端:参数偏好是「这台设备上的手感」,
// 无需登录即可生效、切页面零延迟,也不占数据库。
// ---------------------------------------------------------------------------

const PREFIX = "nv:pref:";

export function useStickyState<T>(
  key: string,
  initial: T,
  /** 返回 false 则丢弃存值(用默认)。用于校验模型是否还存在、档位是否合法等。 */
  validate?: (v: T) => boolean
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  // 只在挂载后写,避免"首渲染用默认值"这一步把用户存的值覆盖掉。
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as T;
        if (!validate || validate(parsed)) setValue(parsed);
      }
    } catch {
      /* 隐私模式 / 存了脏数据 → 忽略,用默认值 */
    }
    hydrated.current = true;
    // key 变了要重读;validate 是内联函数每次新引用,不能进依赖否则死循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated.current) return; // 挂载读取那一轮不回写
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* 配额满 / 隐私模式 → 静默,不影响功能 */
    }
  }, [key, value]);

  return [value, setValue];
}
