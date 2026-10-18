"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n/locale-context";

/**
 * 退出登录后的确认提示。
 *
 * signOut 会整页跳到 `/?signedout=1`(见 auth-context),整页跳会丢掉内存里的
 * toast 队列,所以用 URL 参数把「已退出」这件事带过来,落地后再弹一次并把参数擦掉
 * (免得用户刷新/收藏时重复弹)。
 */
export function SignedOutNotice() {
  const { toast } = useToast();
  const { locale } = useI18n();

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("signedout") !== "1") return;
    url.searchParams.delete("signedout");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    toast(locale === "en" ? "Signed out" : "已退出登录", "success");
  }, [toast, locale]);

  return null;
}
