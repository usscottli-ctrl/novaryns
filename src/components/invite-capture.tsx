"use client";

import { useEffect } from "react";

// 邀请有奖:任何页面带 ?invite=码 进来,就把码记进 cookie(30 天)。好友之后注册时
// (哪怕先逛了别的页面、隔天再来)服务端读这个 cookie 绑定邀请关系;注册页也会把它预填进邀请码框。
export function InviteCapture() {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("invite");
    if (code && /^[A-Za-z0-9]{4,12}$/.test(code)) {
      document.cookie = `nv_invite=${code.toUpperCase()}; path=/; max-age=${30 * 86400}; samesite=lax`;
    }
  }, []);
  return null;
}

/** 读邀请链接记下的码(注册页预填用)。 */
export function readInviteCookie(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.match(/(?:^|;\s*)nv_invite=([A-Za-z0-9]{4,12})/)?.[1] ?? "";
}
