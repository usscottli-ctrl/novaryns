"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { cdnUrl, cdnThumb, onImgError, probeCdnHealth } from "@/lib/cdn";

// Real image with a tasteful gradient fallback + loading skeleton, so the UI
// always looks finished even if a CDN image fails or the user is offline.
export function Media({
  src,
  alt,
  ratio = "aspect-[4/3]",
  gradient = "from-emerald-100 to-teal-100",
  className,
  imgClassName,
  overlay = true,
  children,
  priority = false,
  thumbWidth,
}: {
  src: string;
  alt: string;
  ratio?: string;
  gradient?: string;
  className?: string;
  imgClassName?: string;
  overlay?: boolean;
  children?: React.ReactNode;
  // true = 首屏关键图(eager + high fetch priority),false = 默认 lazy
  priority?: boolean;
  // 列表缩略:设了宽度则在国内 CDN 上实时缩放压缩(海外站自动忽略,原图直出)
  thumbWidth?: number;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  // CDN 改写源不可达(开代理用户请求被挂起,不触发 onError)→ 探测后改用原始源。
  const [useOrig, setUseOrig] = useState(false);
  const rewritten = thumbWidth ? cdnThumb(src, thumbWidth) : cdnUrl(src);
  useEffect(() => {
    if (rewritten === src) return; // 未配 CDN(海外/自托管),无需探测
    let on = true;
    void probeCdnHealth(rewritten).then((ok) => {
      if (on && !ok) setUseOrig(true);
    });
    return () => {
      on = false;
    };
  }, [rewritten, src]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-secondary",
        ratio,
        className
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-br transition-opacity duration-500",
          gradient,
          state === "ready" ? "opacity-0" : "opacity-100"
        )}
      />
      {state === "loading" && (
        <div className="absolute inset-0 animate-pulse bg-secondary" />
      )}
      {state !== "error" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={useOrig ? src : rewritten}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          // @ts-expect-error React 18 typings 不识别 fetchpriority,但 HTML 已支持
          fetchpriority={priority ? "high" : undefined}
          onLoad={() => setState("ready")}
          onError={(e) => { if (!onImgError(e, src)) setState("error"); }}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
            state === "ready" ? "opacity-100" : "opacity-0",
            imgClassName
          )}
        />
      )}
      {overlay && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-900/15 via-transparent to-transparent" />
      )}
      {children}
    </div>
  );
}
