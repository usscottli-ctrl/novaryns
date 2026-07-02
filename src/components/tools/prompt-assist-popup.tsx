"use client";

import * as React from "react";
import { X, Wand2, Sparkles, Loader2, Check, ArrowUp } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Result = {
  id: string;
  mode: "write" | "optimize";
  text: string;
  at: string; // 生成时间(展示用)
  err?: boolean;
};

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 「AI帮写 / 智能优化」统一组件(全站,对标创次元):
 * - AI帮写(mode=write):贴按钮弹窗(anchorRef 定位,优先右侧;小屏底部弹层),
 *   结果带时间戳留在历史,点「使用该描述」填回;底部可继续「免费·发送」。
 * - 智能优化(mode=optimize):**独立居中弹窗**(竞品同款):优化结果放可编辑
 *   文本框,下面一颗全宽「使用该描述」。
 * - 带图(imageFile)时模型看图写;tool 决定后端的分功能页写法指令。
 * 触发:页面设 run={mode,nonce}(nonce 变化即跑一次)并置 open=true。
 */
export function PromptAssistPopup({
  open,
  onClose,
  anchorRef,
  tool,
  category = "",
  currentPrompt,
  imageFile = null,
  imageThumb = "",
  run,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** 工具标识(如 generate/suite/inpaint…),后端据此附加分工具写法指令 */
  tool: string;
  category?: string;
  currentPrompt: string;
  imageFile?: File | null;
  imageThumb?: string;
  run: { mode: "write" | "optimize"; nonce: number } | null;
  onUse: (text: string) => void;
}) {
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  // 帮写(历史面板)
  const [history, setHistory] = React.useState<Result[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [usedId, setUsedId] = React.useState<string | null>(null);
  // 智能优化(独立居中弹窗)
  const [view, setView] = React.useState<"write" | "optimize">("write");
  const [optText, setOptText] = React.useState("");
  const [optErr, setOptErr] = React.useState<string | null>(null);
  const [optBusy, setOptBusy] = React.useState(false);
  const [optUsed, setOptUsed] = React.useState(false);
  // 定位
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const [sheet, setSheet] = React.useState(false); // 小屏:底部弹层
  const lastNonce = React.useRef(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const W = 380; // 帮写弹窗宽
  const H = 480; // 帮写弹窗最大高

  // 依据触发按钮位置计算弹窗坐标:优先右侧,放不下换左侧,再不行贴着钉在可视区内。
  const place = React.useCallback(() => {
    const el = anchorRef.current;
    if (typeof window === "undefined") return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw < 640 || !el) {
      setSheet(true);
      setPos(null);
      return;
    }
    setSheet(false);
    const r = el.getBoundingClientRect();
    let left: number;
    if (r.right + 12 + W <= vw - 12) left = r.right + 12;
    else if (r.left - 12 - W >= 12) left = r.left - 12 - W;
    else left = Math.max(12, Math.min(vw - W - 12, r.left));
    const top = Math.max(12, Math.min(vh - Math.min(H, vh - 24) - 12, r.top - 8));
    setPos({ left, top });
  }, [anchorRef]);

  React.useEffect(() => {
    if (!open || view !== "write") return;
    place();
    const on = () => place();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [open, view, place]);

  // 调 /api/prompt-assist(带图走 multipart 看图写;tool 决定分功能页指令)
  const callApi = React.useCallback(
    async (
      mode: "write" | "optimize",
      idea: string
    ): Promise<{ ok: boolean; text: string }> => {
      try {
        let res: Response;
        if (imageFile) {
          const fd = new FormData();
          fd.append("idea", idea);
          fd.append("category", category);
          fd.append("mode", mode);
          fd.append("tool", tool);
          fd.append("image", imageFile);
          res = await fetch("/api/prompt-assist", {
            method: "POST",
            headers: await authHeader(),
            body: fd,
          });
        } else {
          res = await fetch("/api/prompt-assist", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await authHeader()) },
            body: JSON.stringify({ idea, category, mode, tool }),
          });
        }
        const data = await res.json();
        if (res.ok && data.prompt) return { ok: true, text: data.prompt as string };
        return { ok: false, text: data.error || L("失败,请重试", "Failed, please retry") };
      } catch {
        return { ok: false, text: L("网络错误,请重试", "Network error") };
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imageFile, category, tool]
  );

  // 帮写:结果进历史(不覆盖)
  const doWrite = React.useCallback(
    async (idea: string) => {
      setBusy(true);
      const r = await callApi("write", idea);
      setHistory((h) => [
        ...h,
        { id: `${r.ok ? "r" : "e"}-${Date.now()}`, mode: "write", text: r.text, at: nowStamp(), err: !r.ok },
      ]);
      setBusy(false);
    },
    [callApi]
  );

  // 智能优化:结果进独立弹窗的可编辑文本框
  const doOptimize = React.useCallback(
    async (idea: string) => {
      setOptBusy(true);
      setOptErr(null);
      setOptUsed(false);
      const r = await callApi("optimize", idea);
      if (r.ok) setOptText(r.text);
      else {
        setOptText("");
        setOptErr(r.text);
      }
      setOptBusy(false);
    },
    [callApi]
  );

  // 外部点「AI帮写 / 智能优化」(run.nonce 变化)→ 按模式分流
  React.useEffect(() => {
    if (!run || run.nonce === lastNonce.current) return;
    lastNonce.current = run.nonce;
    setView(run.mode);
    if (run.mode === "optimize") void doOptimize(currentPrompt);
    else void doWrite(currentPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [history, busy]);

  if (!open) return null;

  // ── 智能优化:独立居中弹窗(竞品同款) ──
  if (view === "optimize") {
    return (
      <>
        <div className="fixed inset-0 z-[54] bg-black/30" onClick={onClose} />
        <div
          role="dialog"
          aria-label={L("智能优化", "Optimize")}
          className="fixed left-1/2 top-1/2 z-[55] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-c-border bg-c-card p-5 shadow-pop"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[16px] font-bold text-c-text">
              <Sparkles className="h-4 w-4 text-acc" />
              {L("智能优化", "Optimize")}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label={L("关闭", "Close")}
              className="grid h-7 w-7 place-items-center rounded-full text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {optBusy ? (
            <div className="flex items-center justify-center gap-2 py-14 text-[13px] text-c-text3">
              <Loader2 className="h-4 w-4 animate-spin" />
              {L("AI 正在优化…", "Optimizing…")}
            </div>
          ) : optErr ? (
            <p className="py-10 text-center text-[13px] text-c-danger">{optErr}</p>
          ) : (
            <>
              <textarea
                value={optText}
                onChange={(e) => setOptText(e.target.value)}
                rows={7}
                className="w-full resize-y rounded-xl border border-c-border2 bg-c-card px-3.5 py-3 text-[13.5px] leading-relaxed text-c-text focus-visible:border-acc focus-visible:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  onUse(optText);
                  setOptUsed(true);
                }}
                disabled={!optText.trim()}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[12px] bg-acc px-4 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {optUsed && <Check className="h-4 w-4" />}
                {optUsed ? L("已填入 ✓", "Filled ✓") : L("使用该描述", "Use this")}
              </button>
            </>
          )}
        </div>
      </>
    );
  }

  // ── AI帮写:贴按钮弹窗(历史 + 底部继续发送) ──
  return (
    <>
      {/* 透明点击层:点外面关闭(竞品同款,不压暗页面) */}
      <div className="fixed inset-0 z-[54]" onClick={onClose} />
      <div
        role="dialog"
        aria-label={L("AI帮写", "AI write")}
        style={sheet ? undefined : pos ? { left: pos.left, top: pos.top, width: W } : { visibility: "hidden" }}
        className={cn(
          "fixed z-[55] flex flex-col overflow-hidden rounded-2xl border border-c-border bg-c-card shadow-pop",
          sheet ? "inset-x-3 bottom-3 max-h-[72vh]" : "max-h-[480px]"
        )}
      >
        {/* 头 */}
        <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
          <h3 className="flex items-center gap-1.5 text-[14.5px] font-bold text-c-text">
            <Wand2 className="h-4 w-4 text-acc" />
            {L("AI帮写", "AI write")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={L("关闭", "Close")}
            className="grid h-7 w-7 place-items-center rounded-full text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 历史 */}
        <div ref={scrollRef} className="min-h-[160px] flex-1 space-y-3 overflow-y-auto px-4 pb-3">
          {history.length === 0 && !busy && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Sparkles className="h-7 w-7 text-c-text4" />
              <p className="max-w-[260px] text-[12.5px] leading-relaxed text-c-text3">
                {L(
                  "输入一句想法点「发送」,结果会留在这里,挑一条使用。",
                  "Type an idea and send — results stay here, pick one to use."
                )}
              </p>
            </div>
          )}
          {history.map((r) => (
            <div key={r.id}>
              <p className="mb-1 flex items-center gap-1 text-[11px] text-c-text4">
                <Wand2 className="h-3 w-3" />
                {L("AI帮写", "AI write")} · {r.at}
              </p>
              <div className="rounded-xl bg-c-subtle2 p-3">
                <p
                  className={cn(
                    "whitespace-pre-wrap text-[13px] leading-relaxed",
                    r.err ? "text-c-danger" : "text-c-text"
                  )}
                >
                  {r.text}
                </p>
                {!r.err && (
                  <button
                    type="button"
                    onClick={() => {
                      onUse(r.text);
                      setUsedId(r.id);
                    }}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-[10px] bg-acc px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {usedId === r.id ? L("已填入 ✓", "Filled ✓") : L("使用该描述", "Use this")}
                  </button>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 px-1 py-1 text-[13px] text-c-text3">
              <Loader2 className="h-4 w-4 animate-spin" />
              {L("AI 正在写…", "Writing…")}
            </div>
          )}
        </div>

        {/* 底部输入 */}
        <div className="flex items-end gap-2 border-t border-c-border p-3">
          {imageThumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageThumb}
              alt=""
              className="h-9 w-9 flex-none rounded-lg border border-c-border object-cover"
            />
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={1}
            placeholder={L("补充想法,继续帮写…", "Add an idea…")}
            className="max-h-24 min-h-[38px] flex-1 resize-none rounded-[10px] border border-c-border2 bg-c-subtle2 px-3 py-2 text-[13px] text-c-text placeholder:text-c-text4 focus-visible:border-acc focus-visible:bg-c-card focus-visible:outline-none"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const idea = input.trim() || currentPrompt.trim();
              if (!idea && !imageFile) {
                setHistory((h) => [
                  ...h,
                  {
                    id: `e-${Date.now()}`,
                    mode: "write",
                    text: L("请先写点想法,或上传图片再帮写。", "Type an idea or upload an image first."),
                    at: nowStamp(),
                    err: true,
                  },
                ]);
                return;
              }
              void doWrite(idea);
              setInput("");
            }}
            className="flex h-[38px] flex-none items-center gap-1.5 rounded-[10px] bg-acc px-3 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            {L("免费 · 发送", "Free · Send")}
          </button>
        </div>
      </div>
    </>
  );
}
