"use client";

import * as React from "react";
import { UploadCloud, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-context";
import { cn } from "@/lib/utils";

/** 上传拖拽区(spec B.10)。虚线框 + 上传图标 + 文案,hover/拖入高亮 accent。 */
export function DropZone({
  onFiles,
  accept = "image/*",
  multiple = false,
  title,
  hint,
  compact,
  className,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  title?: string;
  hint?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const pick = (files: FileList | null) => {
    if (files && files.length) onFiles(Array.from(files));
  };
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        pick(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed bg-c-subtle2 text-center transition-colors",
        compact ? "p-4" : "p-7",
        drag ? "border-acc bg-acc-tint" : "border-c-border2 hover:border-acc",
        className
      )}
    >
      <UploadCloud size={compact ? 20 : 24} className="text-c-text3" />
      <span className="text-[13px] font-medium text-c-text2">{title ?? L("点击或拖拽上传", "Click or drag to upload")}</span>
      {hint ? <span className="text-[11.5px] text-c-text3">{hint}</span> : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** 已上传缩略(spec B.10)。右上黑色圆形 ✕ 移除。 */
export function UploadedThumb({
  src,
  onRemove,
  size = 54,
}: {
  src: string;
  onRemove?: () => void;
  size?: number;
}) {
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="h-full w-full rounded-[10px] border border-c-border object-cover"
      />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={L("移除", "Remove")}
          className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#16181D] text-white shadow"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
