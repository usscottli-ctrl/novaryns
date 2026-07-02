"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  ArrowUp,
  Paperclip,
  Loader2,
  ChevronDown,
  Check,
  X,
  RefreshCw,
} from "lucide-react";
import { authHeader } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { cdnUrl } from "@/lib/cdn";
import { GenLoader } from "@/components/gen-loader";
import { ImageLightbox } from "@/components/image-lightbox";
import { cn } from "@/lib/utils";
import { GENERATION_RATIOS, GENERATION_STYLES } from "@/lib/mock-data";
import { takePendingRefs } from "@/lib/pending-refs";

const RESOLUTIONS = [
  { id: "1K", label: "1K 标准" },
  { id: "2K", label: "2K 高清" },
];
const MAX_REF = 6;
const MAX_REF_SIZE = 12 * 1024 * 1024;

// 通用下拉胶囊(与首页对话框一致):点开选项,选中即回填
function SelectChip({
  label,
  options,
  index,
  onPick,
}: {
  label: string;
  options: string[];
  index: number;
  onPick: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-[9px] border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        {label}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute bottom-[calc(100%+6px)] left-0 z-30 max-h-60 w-44 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-2xl">
          {options.map((o, i) => (
            <button
              key={o + i}
              type="button"
              onClick={() => {
                onPick(i);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-secondary",
                i === index
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <span className="min-w-0 truncate">{o}</span>
              <Check
                className={cn(
                  "h-3 w-3 flex-none text-primary",
                  i === index ? "opacity-100" : "opacity-0"
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type GenImg = { id: string; image: string };
type Turn = {
  id: string;
  you: string;
  pending: boolean;
  line?: string;
  images?: GenImg[];
  error?: string;
};

export function GenChatClient() {
  const { user, ready } = useAuth();
  const { openAuth } = useAuthModal();
  const { t, te } = useI18n();
  const router = useRouter();
  const params = useSearchParams();

  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [ratioIdx, setRatioIdx] = useState(0);
  const [styleIdx, setStyleIdx] = useState(0);
  const [resIdx, setResIdx] = useState(0);
  const [count, setCount] = useState(1);
  // 对话框内嵌参考图(图生图):File + 预览 URL
  const [refFiles, setRefFiles] = useState<File[]>([]);
  const [refPreviews, setRefPreviews] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // 「以这张继续改」选中的底图(图生图来源)+ 其作品 id(血缘 parent)
  const [base, setBase] = useState<{ image: string; id: string } | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
    null
  );
  const streamRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  // 多会话(DB 持久化)
  const [sessionId, setSessionId] = useState<string>("");
  const [sessions, setSessions] = useState<
    { id: string; title: string; updatedAt: string }[]
  >([]);
  const sessionIdRef = useRef("");
  sessionIdRef.current = sessionId;

  const newId = () =>
    `gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function refreshSessions() {
    if (!user) return;
    try {
      const r = await fetch(
        `/api/genchat?email=${encodeURIComponent(user.email)}`
      );
      const d = await r.json();
      setSessions((d.sessions ?? []) as typeof sessions);
    } catch {}
  }

  async function loadSession(id: string) {
    if (!user) return;
    try {
      const r = await fetch(
        `/api/genchat?email=${encodeURIComponent(user.email)}&session=${encodeURIComponent(id)}`
      );
      const d = await r.json();
      const s = d.session as { id: string; turns: Turn[] } | null;
      if (s) {
        setSessionId(s.id);
        setTurns(Array.isArray(s.turns) ? s.turns : []);
        setBase(null);
      }
    } catch {}
  }

  function newSession() {
    setSessionId(newId());
    setTurns([]);
    setBase(null);
  }

  useEffect(() => {
    if (ready && !user) openAuth("sign-in");
  }, [ready, user, openAuth]);

  // 自动滚到底
  useEffect(() => {
    streamRef.current?.scrollTo({
      top: streamRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  // 进入:拉会话列表 → 有 ?prompt 则开新会话自动发首轮,否则载入最近会话/空会话
  useEffect(() => {
    if (startedRef.current || !ready || !user) return;
    startedRef.current = true;
    const qp = params.get("prompt");
    const qr = params.get("ratio");
    const qs = params.get("style");
    if (qr) {
      const i = GENERATION_RATIOS.findIndex((r) => r.id === qr);
      if (i >= 0) setRatioIdx(i);
    }
    if (qs) {
      const i = GENERATION_STYLES.findIndex((s) => s === qs);
      if (i >= 0) setStyleIdx(i);
    }
    const refs = takePendingRefs();
    void (async () => {
      const list = await fetch(
        `/api/genchat?email=${encodeURIComponent(user.email)}`
      )
        .then((r) => r.json())
        .then((d) => (d.sessions ?? []) as typeof sessions)
        .catch(() => [] as typeof sessions);
      setSessions(list);
      if ((qp && qp.trim()) || refs.length) {
        const sid = newId();
        setSessionId(sid);
        sessionIdRef.current = sid;
        await sendTurn(qp?.trim() || "保留参考图主体,生成一张高质量的电商商品图", {
          ratio: qr || GENERATION_RATIOS[0]?.id || "auto",
          style: qs || GENERATION_STYLES[0] || "",
          resolution: params.get("resolution") || "1K",
          refs,
        });
      } else if (list.length) {
        await loadSession(list[0].id);
      } else {
        newSession();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user]);

  // 自动持久化:turns 变化且不在生成中 → 保存当前会话(防抖)
  useEffect(() => {
    if (!user || !sessionId || busy || turns.length === 0) return;
    const id = setTimeout(() => {
      const title = turns[0]?.you?.slice(0, 40) || "新会话";
      fetch("/api/genchat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, id: sessionId, title, turns }),
      })
        .then(() => refreshSessions())
        .catch(() => {});
    }, 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, busy, sessionId]);

  function pickRefs(files: FileList | null) {
    if (!files) return;
    const room = MAX_REF - refFiles.length;
    const arr = Array.from(files)
      .filter((f) => f.size <= MAX_REF_SIZE)
      .slice(0, room);
    if (!arr.length) return;
    setRefFiles((prev) => [...prev, ...arr]);
    setRefPreviews((prev) => [...prev, ...arr.map((f) => URL.createObjectURL(f))]);
    if (fileRef.current) fileRef.current.value = "";
  }
  function removeRef(i: number) {
    setRefPreviews((prev) => {
      const u = prev[i];
      if (u) URL.revokeObjectURL(u);
      return prev.filter((_, j) => j !== i);
    });
    setRefFiles((prev) => prev.filter((_, j) => j !== i));
  }
  // 发送当前输入(回车 / 点发送共用):带上内嵌参考图 + 选中的分辨率,发完清空参考图
  function submit() {
    if (busy || !input.trim()) return;
    const refs = refFiles;
    void sendTurn(input, { refs, resolution: RESOLUTIONS[resIdx]?.id ?? "1K" });
    setRefPreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
    setRefFiles([]);
  }

  async function sendTurn(
    text: string,
    override?: {
      ratio?: string;
      style?: string;
      resolution?: string;
      refs?: File[];
    }
  ) {
    if (!user || busy) return;
    const prompt = text.trim();
    if (!prompt) return;
    setInput("");
    setBusy(true);
    const turnId = `turn-${turns.length}-${prompt.slice(0, 6)}`;
    setTurns((prev) => [...prev, { id: turnId, you: prompt, pending: true }]);
    const curBase = base;
    try {
      const fd = new FormData();
      fd.append("prompt", prompt);
      fd.append("category", "main");
      fd.append("ratio", override?.ratio ?? GENERATION_RATIOS[ratioIdx]?.id ?? "auto");
      fd.append("resolution", override?.resolution ?? "1K");
      fd.append("style", override?.style ?? GENERATION_STYLES[styleIdx] ?? "");
      fd.append("count", String(count));
      fd.append("email", user.email);
      if (curBase) {
        fd.append("parentId", curBase.id);
        const dl = await fetch(
          `/api/download?u=${encodeURIComponent(curBase.image)}&n=base.png`
        );
        if (dl.ok) {
          const blob = await dl.blob();
          fd.append(
            "image",
            new File([blob], "base.png", { type: blob.type || "image/png" })
          );
        }
      }
      // 首页带来的参考图(图生图)
      (override?.refs ?? []).forEach((f) => fd.append("image", f));
      const startRes = await fetch("/api/generate-image", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const start = await startRes.json();
      if (!startRes.ok) throw new Error(start.error || t("genchat.fail"));
      const jobId: string | undefined = start.jobId;
      if (!jobId) throw new Error(t("genchat.fail"));
      const deadline = Date.now() + 6 * 60 * 1000;
      let images: GenImg[] = [];
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500));
        if (Date.now() > deadline) throw new Error(t("genchat.fail"));
        const pr = await fetch(
          `/api/generate-image?job=${encodeURIComponent(jobId)}`,
          { cache: "no-store" }
        );
        const pj = await pr.json();
        if (pj.status === "done") {
          images = ((pj.images ?? []) as { id: string; url?: string; image?: string }[]).map(
            (im) => ({ id: im.id, image: im.image || im.url || "" })
          );
          break;
        }
        if (pj.status === "error") throw new Error(pj.error || t("genchat.fail"));
      }
      setTurns((prev) =>
        prev.map((tn) =>
          tn.id === turnId
            ? {
                ...tn,
                pending: false,
                line: t("genchat.aiLine"),
                images,
              }
            : tn
        )
      );
    } catch (e) {
      setTurns((prev) =>
        prev.map((tn) =>
          tn.id === turnId
            ? {
                ...tn,
                pending: false,
                error: e instanceof Error ? e.message : t("genchat.fail"),
              }
            : tn
        )
      );
    } finally {
      setBusy(false);
    }
  }

  function continueFrom(img: GenImg) {
    setBase(img);
    // 聚焦输入框
    const el = document.getElementById("gc-input") as HTMLTextAreaElement | null;
    el?.focus();
  }

  async function exportImg(img: GenImg) {
    try {
      const r = await fetch(
        `/api/download?u=${encodeURIComponent(img.image)}&n=image.png`
      );
      if (!r.ok) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "image.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {}
  }

  if (!ready || !user) {
    return (
      <div className="flex h-[calc(100dvh-58px)] items-center justify-center text-sm text-muted-foreground md:h-dvh">
        {t("genchat.loading")}
      </div>
    );
  }

  // 当前会话若不在列表里(刚新建未保存),也置顶显示
  const liveTitle = turns[0]?.you?.slice(0, 24);
  const showLive =
    sessionId && !sessions.some((s) => s.id === sessionId) && liveTitle;

  return (
    <div className="flex h-[calc(100dvh-58px)] md:h-dvh">
      {/* 左:会话列表 */}
      <aside className="hidden w-[236px] flex-none flex-col border-r border-border bg-card md:flex">
        <button
          type="button"
          onClick={newSession}
          className="mx-3.5 mb-2 mt-4 flex items-center gap-2 rounded-[10px] border border-border px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-secondary"
        >
          <Plus className="h-4 w-4" />
          {t("genchat.newGen")}
        </button>
        <p className="px-[18px] pb-1 pt-2 text-[11px] font-bold tracking-wide text-muted-foreground/70">
          {t("genchat.history")}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {showLive && (
            <button
              type="button"
              className="mx-2 mb-0.5 block w-[calc(100%-1rem)] truncate rounded-lg bg-secondary px-3.5 py-2.5 text-left text-[13px] font-medium text-foreground"
            >
              {liveTitle}
            </button>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => loadSession(s.id)}
              className={cn(
                "mx-2 mb-0.5 block w-[calc(100%-1rem)] truncate rounded-lg px-3.5 py-2.5 text-left text-[13px] transition-colors",
                s.id === sessionId
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60"
              )}
            >
              {s.title || t("genchat.newGen")}
            </button>
          ))}
          {sessions.length === 0 && !showLive && (
            <p className="px-4 py-3 text-xs text-muted-foreground/60">
              {t("genchat.noSessions")}
            </p>
          )}
        </div>
      </aside>

      {/* 中:对话区 */}
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {/* 顶栏:模式切换(统一放右上角,与工作台模式一致) */}
        <div className="flex flex-none items-center justify-end gap-3 border-b border-border px-4 py-2.5">
          <div className="flex gap-0.5 rounded-[9px] bg-secondary p-[3px]">
            <Link
              href="/generate"
              className="flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              🖥 {t("genchat.modeWork")}
            </Link>
            <span className="flex items-center gap-1.5 rounded-[7px] bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm">
              💬 {t("genchat.modeChat")}
            </span>
          </div>
        </div>

        {/* 消息流 */}
        <div ref={streamRef} className="flex-1 overflow-y-auto py-6">
          {turns.length === 0 ? (
            <div className="mx-auto max-w-[720px] px-6 py-16 text-center text-sm text-muted-foreground">
              {t("genchat.empty")}
            </div>
          ) : (
            turns.map((tn) => (
              <div key={tn.id} className="mx-auto mb-7 max-w-[720px] px-6">
                {/* 用户气泡 */}
                <div className="mb-3.5 flex justify-end">
                  <div className="max-w-[80%] rounded-[14px] rounded-br-[4px] bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
                    {tn.you}
                  </div>
                </div>
                {/* AI 回复 */}
                <div className="flex gap-3">
                  <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[#0a5e54] text-[13px] font-extrabold text-white">
                    星
                  </span>
                  <div className="min-w-0 flex-1">
                    {tn.pending ? (
                      <div className="max-w-[420px]">
                        <div className="mb-2.5 text-[13px] text-muted-foreground">
                          {t("genchat.generating")}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {Array.from({ length: count >= 2 ? 2 : 1 }).map((_, i) => (
                            <div
                              key={i}
                              className="relative h-[190px] overflow-hidden rounded-xl bg-secondary"
                            >
                              <GenLoader compact />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : tn.error ? (
                      <div className="text-[13px] font-medium text-red-500">
                        {tn.error}
                      </div>
                    ) : (
                      <>
                        <div className="mb-2.5 text-[13px] text-muted-foreground">
                          {tn.line}
                        </div>
                        <div
                          className={cn(
                            "grid max-w-[420px] gap-3",
                            (tn.images?.length ?? 0) > 1
                              ? "grid-cols-2"
                              : "grid-cols-1"
                          )}
                        >
                          {tn.images?.map((im) => (
                            <div
                              key={im.id}
                              className="group relative overflow-hidden rounded-xl bg-secondary shadow-sm"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={cdnUrl(im.image)}
                                alt={tn.you}
                                className="h-[190px] w-full object-cover"
                              />
                              {/* 整图点击 → 看大图 */}
                              <button
                                type="button"
                                onClick={() =>
                                  setLightbox({ src: im.image, alt: tn.you })
                                }
                                className="absolute inset-0 h-full w-full cursor-pointer"
                                aria-label={t("genchat.chipView")}
                              />
                              {/* 左下角:以此图再生成(= setBase 继续) */}
                              <button
                                type="button"
                                onClick={() => continueFrom(im)}
                                className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-[rgba(22,24,29,.6)] px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-[rgba(22,24,29,.8)]"
                              >
                                <RefreshCw className="h-3 w-3" />
                                {t("genchat.chipRegen")}
                              </button>
                            </div>
                          ))}
                        </div>
                        {tn.images && tn.images.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => continueFrom(tn.images![0])}
                              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                            >
                              {t("genchat.chipContinue")}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setLightbox({
                                  src: tn.images![0].image,
                                  alt: tn.you,
                                })
                              }
                              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                            >
                              {t("genchat.chipView")}
                            </button>
                            <button
                              type="button"
                              onClick={() => exportImg(tn.images![0])}
                              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                            >
                              {t("genchat.chipExport")}
                            </button>
                            <Link
                              href="/canvas"
                              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                            >
                              {t("genchat.chipCanvas")}
                            </Link>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 底部输入器 */}
        <div className="flex-none border-t border-border bg-background px-4 py-3.5 sm:px-6">
          <div className="mx-auto max-w-[720px]">
            {base && (
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cdnUrl(base.image)}
                  alt=""
                  className="h-8 w-8 rounded-md object-cover"
                />
                {t("genchat.basedOn")}
                <button
                  type="button"
                  onClick={() => setBase(null)}
                  className="text-primary hover:underline"
                >
                  {t("genchat.clearBase")}
                </button>
              </div>
            )}
            <div className="rounded-[18px] border border-border bg-card p-3.5 shadow-lg transition-shadow focus-within:shadow-xl">
              {/* 已选参考图缩略(内嵌,不跳页) */}
              {refPreviews.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {refPreviews.map((src, i) => (
                    <div
                      key={src}
                      className="relative h-14 w-14 overflow-hidden rounded-lg border border-border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeRef(i)}
                        className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl-md bg-black/65 text-white"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                id="gc-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder={t("genchat.placeholder")}
                className="block min-h-[40px] w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {/* 参考图:内嵌上传(不跳页) */}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => pickRefs(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-[9px] border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  {t("genchat.chipRef")}
                  {refFiles.length > 0 && (
                    <span className="text-primary">·{refFiles.length}</span>
                  )}
                </button>
                <SelectChip
                  label={te(
                    `gen.ratios.${ratioIdx}`,
                    GENERATION_RATIOS[ratioIdx]?.label ?? "比例"
                  )}
                  options={GENERATION_RATIOS.map((r, i) =>
                    te(`gen.ratios.${i}`, r.label)
                  )}
                  index={ratioIdx}
                  onPick={setRatioIdx}
                />
                <SelectChip
                  label={te(
                    `gen.styles.${styleIdx}`,
                    GENERATION_STYLES[styleIdx] ?? "风格"
                  )}
                  options={GENERATION_STYLES.map((s, i) =>
                    te(`gen.styles.${i}`, s)
                  )}
                  index={styleIdx}
                  onPick={setStyleIdx}
                />
                <SelectChip
                  label={RESOLUTIONS[resIdx]?.label ?? "清晰度"}
                  options={RESOLUTIONS.map((r) => r.label)}
                  index={resIdx}
                  onPick={setResIdx}
                />
                <SelectChip
                  label={`×${count}`}
                  options={[1, 2, 4].map((n) => `×${n}`)}
                  index={[1, 2, 4].indexOf(count) < 0 ? 0 : [1, 2, 4].indexOf(count)}
                  onPick={(i) => setCount([1, 2, 4][i])}
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || !input.trim()}
                  aria-label={t("genchat.send")}
                  className="ml-auto flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ArrowUp className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {t("genchat.footHint")}
            </p>
          </div>
        </div>
      </div>

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
