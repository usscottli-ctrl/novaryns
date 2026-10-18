"use client";

import { useCallback, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// 「离开页面也能收到完成提醒」。
//
// 场景:生图/试穿等要跑几十秒的异步任务,手机用户经常在等待时切到别的 App,
// 回来完全不知道好没好。前台完成靠调用方弹 toast 就够;**后台完成**(页面不可见)
// toast 用户根本看不到 —— 这时把 document.title 改成「✅ …」是最可靠的跨平台信号
// (回到浏览器一眼看到 tab 标题变了),已授权的话再补一条系统通知。
//
// iOS Safari 非 PWA 不支持 Notification 构造器 → 特性检测 + try/catch 优雅降级到只改标题。
// ---------------------------------------------------------------------------
export function useAwayAlert() {
  const original = useRef<string>("");

  const restore = useCallback(() => {
    if (original.current) {
      document.title = original.current;
      original.current = "";
    }
  }, []);

  // 页面重新可见/获得焦点 → 还原标题。
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) restore();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", restore);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", restore);
    };
  }, [restore]);

  // 任务完成时调用。仅在页面**当前不可见**时才动标题/发通知;可见时什么都不做,
  // 交给调用方的 toast(避免和 toast 重复提醒)。
  const fire = useCallback((message: string) => {
    if (typeof document === "undefined" || !document.hidden) return;
    if (!original.current) original.current = document.title;
    document.title = `✅ ${message}`;
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(message);
      }
    } catch {
      /* 某些内嵌浏览器构造 Notification 会抛,忽略 */
    }
  }, []);

  // 可选:在用户手势(点「生成」)里礼貌请求一次通知权限。只在从未决定过时问,
  // 拒绝了就不再打扰 —— 后续仍有改标题兜底。必须在用户手势内调用才会弹窗。
  const askPermission = useCallback(() => {
    try {
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    } catch {
      /* 不支持则忽略 */
    }
  }, []);

  return { fire, askPermission };
}
