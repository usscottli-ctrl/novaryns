"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-context";
import { cn } from "@/lib/utils";

/** 弹窗(spec B.8)。遮罩 rgba(22,24,29,.5)+blur,卡面圆角18+pop 阴影,右上 ✕。 */
export function Modal({
  open,
  onClose,
  children,
  className,
  width = 520,
  showClose = true,
  closeOnOverlay = true,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  width?: number;
  showClose?: boolean;
  closeOnOverlay?: boolean;
}) {
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      onMouseDown={() => closeOnOverlay && onClose()}
    >
      <div className="absolute inset-0 bg-[rgba(22,24,29,.5)] backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width, maxWidth: "100%" }}
        className={cn(
          "nv-menu-down relative z-10 max-h-[90vh] overflow-auto rounded-[18px] bg-c-card p-6 shadow-pop",
          className
        )}
      >
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={L("关闭", "Close")}
            className="absolute right-3.5 top-3.5 grid h-8 w-8 place-items-center rounded-[9px] text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
          >
            <X size={17} />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}
