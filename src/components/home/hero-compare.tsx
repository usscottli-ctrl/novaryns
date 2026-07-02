"use client";

import { useEffect, useRef, useState } from "react";
import { cdnUrl } from "@/lib/cdn";

/**
 * 落地页 hero「随手拍 → AI 成片」对比:两图叠放,中间分隔条可拖动(clip-path 擦除);
 * 持续自动来回擦演示,拖动时暂停、松手平滑回归。两图都 object-cover 填满,天然对齐。
 */
export function HeroCompare({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [pos, setPos] = useState(58); // 分隔条位置(% from left)

  // 持续自动来回擦,循环演示原图↔成片对比;拖动时暂停,松手后平滑回归自动。
  useEffect(() => {
    // 尊重「减少动态效果」:停在 52%,不自动播放。
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPos(52);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const e = (now - start) / 1000;
      const target = 50 + Math.sin(e * 0.8) * 26; // ~24%–76%,约 8s 一个来回
      if (!dragging.current) {
        setPos((p) => p + (target - p) * 0.06); // lerp 平滑(松手后也平滑回归)
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const fromX = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos(Math.max(2, Math.min(98, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div
      ref={ref}
      className="group relative aspect-[4/3] w-full cursor-ew-resize select-none overflow-hidden rounded-3xl border border-border shadow-2xl sm:aspect-[16/10]"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        fromX(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && fromX(e.clientX)}
      onPointerUp={() => {
        dragging.current = false;
      }}
    >
      {/* AI 成片(底,全幅) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cdnUrl(after)}
        alt={afterLabel}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* 随手拍原图(上,clip 到分隔条左侧) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cdnUrl(before)}
        alt={beforeLabel}
        draggable={false}
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* 标签 */}
      <span className="absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 text-xs font-medium text-white backdrop-blur">
        {beforeLabel}
      </span>
      <span className="absolute right-3 top-3 rounded-md px-2 py-1 text-xs font-semibold text-white [background:var(--grad-acc)]">
        {afterLabel}
      </span>
      {/* 分隔条 + 手柄 */}
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.15)]"
        style={{ left: `${pos}%` }}
      >
        <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#16181D] shadow-lg">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
          </svg>
        </span>
      </div>
    </div>
  );
}
