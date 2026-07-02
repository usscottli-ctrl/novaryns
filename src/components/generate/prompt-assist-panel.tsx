"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Wand2, Sparkles, Loader2, Check, ArrowUp } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Result = { id: string; mode: "write" | "optimize"; text: string; err?: boolean };

// 右侧"AI 创作助手"面板:每次 AI帮写/智能优化的结果都按时间留在历史里(不覆盖),
// 用户挑哪条点「使用该描述」就填进提示词框;底部可继续补充想法再写一条。
export function PromptAssistPanel({
  open,
  onClose,
  category,
  currentPrompt,
  imageFile,
  imageThumb,
  run,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  category: string;
  currentPrompt: string;
  imageFile: File | null;
  imageThumb: string;
  run: { mode: "write" | "optimize"; nonce: number } | null;
  onUse: (text: string) => void;
}) {
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [history, setHistory] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [usedId, setUsedId] = useState<string | null>(null);
  const lastNonce = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const doAssist = useCallback(
    async (mode: "write" | "optimize", idea: string) => {
      setBusy(true);
      try {
        let res: Response;
        if (imageFile) {
          const fd = new FormData();
          fd.append("idea", idea);
          fd.append("category", category);
          fd.append("mode", mode);
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
            body: JSON.stringify({ idea, category, mode }),
          });
        }
        const data = await res.json();
        setHistory((h) => [
          ...h,
          res.ok && data.prompt
            ? { id: `r-${Date.now()}`, mode, text: data.prompt as string }
            : {
                id: `e-${Date.now()}`,
                mode,
                text: data.error || L("失败,请重试", "Failed, please retry"),
                err: true,
              },
        ]);
      } catch {
        setHistory((h) => [
          ...h,
          { id: `e-${Date.now()}`, mode, text: L("网络错误,请重试", "Network error"), err: true },
        ]);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imageFile, category]
  );

  // 点 AI帮写/智能优化(外部 run.nonce 变化)→ 跑一次,结果进历史
  useEffect(() => {
    if (!run || run.nonce === lastNonce.current) return;
    lastNonce.current = run.nonce;
    void doAssist(run.mode, currentPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [history, busy]);

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-[54] bg-black/40 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <div
        role="dialog"
        aria-label={L("AI 创作助手", "AI assistant")}
        className={cn(
          "fixed inset-y-0 right-0 z-[55] flex w-[min(420px,92vw)] flex-col border-l border-border bg-card transition-transform duration-300 ease-out",
          open ? "translate-x-0 shadow-[0_0_60px_rgba(0,0,0,.35)]" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Wand2 className="h-5 w-5 text-primary" />
            {L("AI 创作助手", "AI assistant")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={L("关闭", "Close")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {history.length === 0 && !busy && (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">
              {L(
                "点「AI帮写」或「智能优化」生成提示词,结果会留在这里,挑一条用。",
                "Use AI write / Optimize — results stay here, pick one to use."
              )}
            </p>
          )}
          {history.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-border bg-secondary/30 p-3"
            >
              <div className="mb-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                {r.mode === "write" ? (
                  <Wand2 className="h-3 w-3" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {r.mode === "write" ? L("AI 帮写", "AI write") : L("智能优化", "Optimize")}
              </div>
              <p
                className={cn(
                  "whitespace-pre-wrap text-[13px] leading-relaxed",
                  r.err ? "text-[#e5484d]" : "text-foreground"
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
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" />
                  {usedId === r.id ? L("已填入 ✓", "Filled ✓") : L("使用该描述", "Use this")}
                </button>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {L("AI 正在写…", "Writing…")}
            </div>
          )}
        </div>

        <div className="flex items-end gap-2 border-t border-border p-3">
          {imageThumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageThumb}
              alt="ref"
              className="h-10 w-10 flex-none rounded-lg border border-border object-cover"
            />
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={1}
            placeholder={L(
              "补充想法,例如:换成户外场景 / 更高级…",
              "Add an idea, e.g. outdoor scene / more premium…"
            )}
            className="max-h-24 min-h-[40px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const idea = input.trim() || currentPrompt.trim();
              // 既没想法也没产品图 → 不让模型凭空编,提示一下
              if (!idea && !imageFile) {
                setHistory((h) => [
                  ...h,
                  {
                    id: `e-${Date.now()}`,
                    mode: "write",
                    text: L("请先写点想法,或上传产品图再帮写。", "Type an idea or upload a product image first."),
                    err: true,
                  },
                ]);
                return;
              }
              void doAssist("write", idea);
              setInput("");
            }}
            aria-label={L("帮写", "Write")}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </>
  );
}
