"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isTrackablePath } from "@/lib/analytics";

// ---------------------------------------------------------------------------
// 访问统计上报(客户端信标)。
//
// 为什么放在客户端而不是中间件/服务端:
//  · 中间件跑在 Edge runtime,连不上 Postgres;
//  · 客户端信标天然过滤掉不执行 JS 的爬虫,PV 更接近真人;
//  · App Router 是软导航,服务端只在首屏渲染一次,后续换页服务端根本不知道。
//
// 用 sendBeacon:浏览器在页面卸载/切走时也保证发出去,且不阻塞渲染。
// ---------------------------------------------------------------------------

const SID_KEY = "novaryns:analytics:sid";

function sessionId(): string {
  try {
    let sid = sessionStorage.getItem(SID_KEY);
    if (!sid) {
      sid =
        Math.random().toString(36).slice(2, 10) +
        Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(SID_KEY, sid);
    }
    return sid;
  } catch {
    return ""; // 隐私模式 / 禁用存储 → 无会话号,PV/UV 照常
  }
}

export function Tracker() {
  const pathname = usePathname();
  // 同一路径 1 秒内不重复上报:开发期 StrictMode 会把 effect 跑两遍。
  const last = useRef<{ path: string; at: number } | null>(null);
  // referrer 只在本会话第一条上报时带,后续都是站内跳转没有意义。
  const first = useRef(true);

  useEffect(() => {
    if (!pathname || !isTrackablePath(pathname)) return;
    const now = Date.now();
    if (last.current && last.current.path === pathname && now - last.current.at < 1000)
      return;
    last.current = { path: pathname, at: now };

    const payload = JSON.stringify({
      path: pathname,
      ref: first.current ? document.referrer || "" : "",
      locale: navigator.language || "",
      sid: sessionId(),
    });
    first.current = false;

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/analytics/collect", payload);
      } else {
        void fetch("/api/analytics/collect", {
          method: "POST",
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* 统计失败静默 */
    }
  }, [pathname]);

  return null;
}
