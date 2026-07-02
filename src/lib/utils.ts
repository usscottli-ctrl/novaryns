import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(input: string | number | Date, withTime = false) {
  const date = new Date(input);
  const d = date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  if (!withTime) return d;
  const tm = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${d} ${tm}`;
}

/**
 * 锁定 body 滚动(弹窗打开时用)。
 * 关键:锁住时竖直滚动条消失会让页面宽度突然 +滚动条宽度,导致内容右移。
 * 这里测出滚动条宽度后补一个同宽的 padding-right,避免页面横向跳动。
 * 返回的函数用于解锁(还原原始样式)。
 */
export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  const body = document.body;
  const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
  const prevOverflow = body.style.overflow;
  const prevPaddingRight = body.style.paddingRight;
  body.style.overflow = "hidden";
  if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;
  return () => {
    body.style.overflow = prevOverflow;
    body.style.paddingRight = prevPaddingRight;
  };
}
