"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { AuthPanel } from "@/components/supabase-auth";
import { authMode } from "@/lib/auth-mode";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { lockBodyScroll } from "@/lib/utils";

// 全局登录/注册弹窗:在 layout.tsx 里 mount 一份,任何地方调 openAuth() 就能弹。
// 检测到 user 出现 → 自动关闭(用户登录成功后无需再处理)。
export function AuthModal() {
  const { open, mode, openAuth, closeAuth, setMode } = useAuthModal();
  const { user } = useAuth();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const params = useSearchParams();
  const cardRef = useRef<HTMLDivElement>(null);
  // 防误关:只有「鼠标在遮罩本身按下」才算点遮罩关闭。否则在输入框里选中文本拖到
  // 遮罩外松手,浏览器会把这次 click 算到遮罩上 → 误关弹窗。
  const downOnBackdrop = useRef(false);
  // 方案A:弹窗垂直居中 + 锁高。打开/切登录注册时测一次自然高度作为 min-height,
  // 切手机/邮箱 tab 不重测 → 高度不变、居中位置不动。登录↔注册换 min-height 走过渡动画。
  const [minH, setMinH] = useState<number | null>(null);

  // 旧 /sign-in / /sign-up 路由 redirect 到 /?auth=sign-in/sign-up,在这里捕获
  useEffect(() => {
    const a = params.get("auth");
    if (a === "sign-in" || a === "sign-up") openAuth(a);
  }, [params, openAuth]);

  // 登录/注册成功后自动关闭弹窗
  useEffect(() => {
    if (open && user) closeAuth();
  }, [open, user, closeAuth]);

  // Esc 关闭 + 锁定 body 滚动(带滚动条宽度补偿,防止背景右移)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAuth();
    };
    document.addEventListener("keydown", onKey);
    const unlock = lockBodyScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      unlock();
    };
  }, [open, closeAuth]);

  // 打开 / 切登录注册时测一次卡片自然高度,锁成 min-height。
  // 依赖 [open, mode]:切手机/邮箱 tab(loginMode 在 AuthPanel 内部)不会触发,
  // 所以登录态高度恒定 → 居中位置不动。测量时临时关 transition,防止塌陷闪烁。
  useLayoutEffect(() => {
    if (!open) {
      setMinH(null);
      return;
    }
    const el = cardRef.current;
    if (!el) return;
    const prevTransition = el.style.transition;
    el.style.transition = "none";
    el.style.minHeight = "0px";
    const natural = el.offsetHeight;
    el.style.minHeight = "";
    el.style.transition = prevTransition;
    setMinH(natural);
  }, [open, mode]);

  if (!open) return null;

  return (
    <div
      // 垂直居中容器;高度变化时(登录↔注册)弹窗用 min-height 过渡平滑伸缩并重新居中。
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-900/60 px-4 py-10 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) closeAuth();
      }}
    >
      <div
        ref={cardRef}
        className="relative flex w-full max-w-[440px] flex-col rounded-3xl bg-card px-9 pb-7 pt-10 card-shadow transition-[min-height] duration-300 ease-out"
        style={minH != null ? { minHeight: minH } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={closeAuth}
          aria-label={L("关闭", "Close")}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-secondary/40 text-muted-foreground shadow-sm transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        {authMode === "supabase" ? (
          <AuthPanel
            mode={mode}
            compact
            noRedirect
            onSwitchMode={setMode}
          />
        ) : (
          <AuthForm
            mode={mode}
            compact
            noRedirect
            onSwitchMode={setMode}
          />
        )}
      </div>
    </div>
  );
}
