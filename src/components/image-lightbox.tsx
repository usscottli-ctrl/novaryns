"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cdnUrl } from "@/lib/cdn";
import { downloadImage } from "@/lib/download";
import { useI18n } from "@/lib/i18n/locale-context";

// 透明图棋盘格底(抠图/印花等透明 PNG 放大时显示)。
const CHECKER: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg,#dfe3e8 25%,transparent 25%),linear-gradient(-45deg,#dfe3e8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#dfe3e8 75%),linear-gradient(-45deg,transparent 75%,#dfe3e8 75%)",
  backgroundSize: "18px 18px",
  backgroundPosition: "0 0,0 9px,9px -9px,-9px 0",
  backgroundColor: "#fff",
};

// 全屏大图查看器:滚轮缩放 + 拖动平移 + 双击还原 + 导出 + 点空白/Esc 关闭。全站工具页/记录区共用。
export function ImageLightbox({
  src,
  alt = "",
  onClose,
  downloadName = "novaryns",
  checker = false,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
  downloadName?: string;
  checker?: boolean;
}) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(
    null
  );
  const movedRef = useRef(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // 打开时锁背景滚动:避免滚轮缩放/拖动时穿透滚动底层页面。
  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-[rgba(12,13,16,.82)] backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white">
        <p className="text-sm font-medium">
          {t("gen.viewLarge")} · {Math.round(zoom * 100)}%
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-white/25 bg-card/10 text-white hover:bg-card/20"
            onClick={() => downloadImage(src, downloadName)}
          >
            <Download className="h-3.5 w-3.5" />
            {t("gen.export")}
          </Button>
          <button
            onClick={onClose}
            aria-label={t("gen.close")}
            className="rounded-md p-1.5 text-white hover:bg-card/15"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        className="flex flex-1 items-center justify-center overflow-hidden p-4"
        onClick={(e) => {
          if (movedRef.current) {
            movedRef.current = false;
            return;
          }
          const r = imgRef.current?.getBoundingClientRect();
          if (
            r &&
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top &&
            e.clientY <= r.bottom
          ) {
            return;
          }
          onClose();
        }}
        onWheel={(e) => {
          const next = Math.min(
            6,
            Math.max(1, +(zoom + (e.deltaY < 0 ? 0.25 : -0.25)).toFixed(2))
          );
          setZoom(next);
          if (next === 1) setPan({ x: 0, y: 0 });
        }}
        onDoubleClick={() => {
          setZoom((z) => (z > 1 ? 1 : 2.5));
          setPan({ x: 0, y: 0 });
        }}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          dragRef.current = { sx: e.clientX, sy: e.clientY, bx: pan.x, by: pan.y };
          movedRef.current = false;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const dx = e.clientX - dragRef.current.sx;
          const dy = e.clientY - dragRef.current.sy;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
          setPan({ x: dragRef.current.bx + dx, y: dragRef.current.by + dy });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={cdnUrl(src)}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? "grab" : "zoom-in",
            transition: dragRef.current ? "none" : "transform 0.1s ease-out",
            ...(checker ? CHECKER : {}),
          }}
          className="max-h-full max-w-full select-none object-contain"
        />
      </div>
      <p className="pb-3 text-center text-xs text-white/50">{t("gen.zoomHint")}</p>
    </div>
  );
}
