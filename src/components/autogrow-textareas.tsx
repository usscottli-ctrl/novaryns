"use client";

import { useEffect } from "react";

// 全站多行输入框自动长高(2026-10-20 客户要求):初始大小不变,字多了框跟着变高,删字缩回。
// 统一在这里做,而不是逐个改组件:站内 20 来个输入框写法各异(固定行数 / 固定高 / 最小高),
// 逐个改容易漏。规则:
//   · 首次见到时记下它原本的高度当下限(初始大小不变);
//   · 高度 = max(原高度, 内容高度),上限半屏,再多就框内滚动;
//   · 手动输入(input 事件)和程序填值(「AI 帮写」等 React 直接改 value,不触发事件)都要覆盖,
//     后者靠低频巡检(400ms,只比对 scrollHeight,开销可忽略);
//   · 画布节点里的输入框、带 data-no-autogrow 的不处理(长高会挤乱节点布局)。
const MAX_RATIO = 0.5;

function fit(el: HTMLTextAreaElement) {
  if (el.dataset.noAutogrow !== undefined || el.closest(".react-flow")) return;
  if (el.offsetParent === null) return; // 隐藏中:量不到真实高度,等显示后再说
  if (!el.dataset.baseH) el.dataset.baseH = String(el.offsetHeight);
  const base = Number(el.dataset.baseH) || el.offsetHeight;
  const cs = getComputedStyle(el);
  const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  // 上限半屏,但至少 320px(窗口高度读不到/很矮时不至于把框压扁)
  const max = Math.max(320, Math.round(window.innerHeight * MAX_RATIO));
  const prev = el.style.height;
  el.style.height = "auto";
  const want = Math.min(max, Math.max(base, el.scrollHeight + border));
  el.style.height = `${want}px`;
  el.style.overflowY = el.scrollHeight + border > max ? "auto" : "hidden";
  if (prev !== el.style.height) el.dataset.fitLen = String(el.value.length);
}

export function AutogrowTextareas() {
  useEffect(() => {
    const onInput = (e: Event) => {
      if (e.target instanceof HTMLTextAreaElement) fit(e.target);
    };
    document.addEventListener("input", onInput, true);
    // 程序填值巡检:内容长度变了的才重算
    const timer = window.setInterval(() => {
      document.querySelectorAll("textarea").forEach((el) => {
        if (el.dataset.fitLen !== String(el.value.length)) {
          fit(el);
          el.dataset.fitLen = String(el.value.length);
        }
      });
    }, 400);
    return () => {
      document.removeEventListener("input", onInput, true);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
