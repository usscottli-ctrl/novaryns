"use client";
import { copyText } from "@/lib/clipboard";

import { useEffect, useRef, useState } from "react";
import {
  Type,
  Upload,
  X,
  Copy,
  Check,
  LayoutTemplate,
  Wand2,
  Sparkles,
} from "lucide-react";
import { PromptAssistPopup } from "@/components/tools/prompt-assist-popup";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ToolShell } from "@/components/tools/tool-shell";
import { ToolDemo, getDemo } from "@/components/tools/tool-demo";
import { GenLoader } from "@/components/gen-loader";

const MAX_UPLOAD = 8 * 1024 * 1024;
const ACCENT = "#F5A524";
const TINT = "rgba(245,165,36,.12)";
const ACC_SOFT = "rgba(245,165,36,.10)";

type Opt = { id: string; zh: string; en: string };
const PLATFORMS: Opt[] = [
  { id: "通用", zh: "通用", en: "General" },
  { id: "淘宝天猫", zh: "淘宝/天猫", en: "Taobao/Tmall" },
  { id: "京东", zh: "京东", en: "JD" },
  { id: "拼多多", zh: "拼多多", en: "Pinduoduo" },
  { id: "抖音", zh: "抖音", en: "Douyin" },
  { id: "亚马逊", zh: "亚马逊", en: "Amazon" },
  { id: "TEMU", zh: "TEMU", en: "TEMU" },
  { id: "TikTok", zh: "TikTok", en: "TikTok" },
  { id: "eBay", zh: "eBay", en: "eBay" },
];
const STYLES: Opt[] = [
  { id: "爆款吸睛", zh: "爆款吸睛", en: "Catchy" },
  { id: "简洁专业", zh: "简洁专业", en: "Clean" },
  { id: "高端轻奢", zh: "高端轻奢", en: "Premium" },
  { id: "活泼种草", zh: "活泼种草", en: "Playful" },
];
const LANGS: Opt[] = [
  { id: "中文", zh: "中文", en: "Chinese" },
  { id: "English", zh: "English", en: "English" },
  { id: "中英双语", zh: "中英双语", en: "Bilingual" },
];

// 按电商平台的标题模板:选「使用此模板」→ 填该平台标题习惯对应的字段脚手架 + 切到对应平台与语言。
// 每个平台字段刻意不同:贴合各自的标题结构与搜索/点击习惯。
type Tpl = { id: string; name: string; note: string; platform: string; lang: string; scaffold: string };
// 统一 9 字段结构(对齐同行),各平台仅「平台」与「字符限制」不同。
const titleScaffold = (platform: string, limit: number) =>
  `平台：${platform}\n商品名称：<商品名称>\n商品型号：<商品型号>\n商品颜色：<颜色>\n商品核心词：<商品核心词>\n商品款式/形状：<商品款式或形状>\n适用场景：<场景1>, <场景2>, <场景3>\n主要卖点/附加价值：<卖点，可选>\n品牌：<品牌>\n字符限制：<=${limit}`;

const TEMPLATES: Tpl[] = [
  {
    id: "tb",
    name: "淘宝/天猫",
    note: "关键词堆叠、搜索导向(≤60字符)",
    platform: "淘宝天猫",
    lang: "中文",
    scaffold: titleScaffold("淘宝/天猫", 60),
  },
  {
    id: "jd",
    name: "京东",
    note: "正式、突出品牌与型号(≤60字符)",
    platform: "京东",
    lang: "中文",
    scaffold: titleScaffold("京东", 60),
  },
  {
    id: "pdd",
    name: "拼多多",
    note: "短平快、实惠心智(≤60字符)",
    platform: "拼多多",
    lang: "中文",
    scaffold: titleScaffold("拼多多", 60),
  },
  {
    id: "dy",
    name: "抖音",
    note: "种草口吻、场景情绪带货(≤30字符)",
    platform: "抖音",
    lang: "中文",
    scaffold: titleScaffold("抖音", 30),
  },
  {
    id: "amz",
    name: "亚马逊 Amazon",
    note: "长尾关键词、前置、无促销词(≤200字符)",
    platform: "亚马逊",
    lang: "English",
    scaffold: titleScaffold("亚马逊", 200),
  },
  {
    id: "temu",
    name: "TEMU",
    note: "实惠、多件装、口语化(≤120字符)",
    platform: "TEMU",
    lang: "English",
    scaffold: titleScaffold("TEMU", 120),
  },
  {
    id: "tk",
    name: "TikTok",
    note: "潮流/爆点、抓眼球(≤150字符)",
    platform: "TikTok",
    lang: "English",
    scaffold: titleScaffold("TikTok", 150),
  },
  {
    id: "ebay",
    name: "eBay",
    note: "品牌+型号+物品属性(≤80字符)",
    platform: "eBay",
    lang: "English",
    scaffold: titleScaffold("eBay", 80),
  },
];

export function TitleGenClient() {
  const { user } = useAuth();
  const { openAuth } = useAuthModal();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [thumb, setThumb] = useState("");
  const [idea, setIdea] = useState("");
  const [platform, setPlatform] = useState("通用");
  const [style, setStyle] = useState("爆款吸睛");
  const [lang, setLang] = useState("中文");
  const count = 1; // 标题只生成 1 条(去掉条数选择)
  const [showTpl, setShowTpl] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  // AI帮写/智能优化(贴按钮弹窗;标题页图选填,不强制传图)
  const assistBtnRef = useRef<HTMLButtonElement>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistRun, setAssistRun] = useState<{ mode: "write" | "optimize"; nonce: number } | null>(null);
  function openAssist(mode: "write" | "optimize") {
    setError(null);
    setAssistOpen(true);
    setAssistRun({ mode, nonce: Date.now() });
  }
  const [points, setPoints] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (thumb) URL.revokeObjectURL(thumb);
    };
  }, [thumb]);

  function pickFile(f: File | null) {
    if (!f) return;
    if (f.size > MAX_UPLOAD) {
      setError(L("图片需小于 8MB", "Image must be < 8MB"));
      return;
    }
    setError(null);
    if (thumb) URL.revokeObjectURL(thumb);
    setFile(f);
    setThumb(URL.createObjectURL(f));
  }

  async function copy(text: string, key: string) {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }
  }

  async function generate() {
    if (!user) {
      openAuth();
      return;
    }
    if (!file && !idea.trim()) {
      setError(L("请上传产品图,或写点产品描述/卖点", "Upload a product image or describe it"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      let res: Response;
      const common = {
        idea: idea.trim(),
        platform,
        style,
        lang,
        count: String(count),
      };
      if (file) {
        const fd = new FormData();
        Object.entries(common).forEach(([k, v]) => fd.append(k, v));
        fd.append("image", file);
        res = await fetch("/api/title-gen", {
          method: "POST",
          headers: await authHeader(),
          body: fd,
        });
      } else {
        res = await fetch("/api/title-gen", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({ ...common, count }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? L("生成失败", "Failed"));
      setTitles((data.titles ?? []) as string[]);
      setPoints((data.sellingPoints ?? []) as string[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : L("生成失败,请重试", "Failed, retry"));
    } finally {
      setLoading(false);
    }
  }

  // 选中态/未选态统一样式(accent 描边 + 浅底)。
  const optClass = (active: boolean) =>
    cn(
      "transition-colors",
      active
        ? "border-acc text-acc"
        : "border-c-border text-c-text2 hover:bg-c-subtle"
    );
  const optStyle = (active: boolean) =>
    active ? { background: ACC_SOFT } : undefined;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          pickFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />

      <ToolShell
        name={L("标题生成", "Title Generator")}
        desc={L(
          "上传产品图或写卖点,AI 出一条电商标题和卖点短语",
          "Upload a product or describe it — AI writes a title & selling points"
        )}
        Icon={Type}
        tint={TINT}
        accent={ACCENT}
        category="titles"
        promptLabel={L("生成标题", "Title")}
        cost={0}
        refreshKey={titles.length}
        actionLabel={L("生成标题", "Generate")}
        onAction={generate}
        processing={loading}
        error={error}
        resultTitle={L("生成结果", "Results")}
        footerNote={L("标题生成免费,不扣积分", "Free — no credits used")}
        left={
          <>
            {/* 产品图(可选) */}
            <div>
              <p className="mb-2 text-[12.5px] font-medium text-c-text2">
                {L("产品图", "Product image")}{" "}
                <span className="text-[11px] font-normal text-c-text3">
                  {L("(可选,看图写更准)", "(optional)")}
                </span>
              </p>
              {thumb ? (
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumb}
                    alt="product"
                    className="h-16 w-16 rounded-field border border-c-border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (thumb) URL.revokeObjectURL(thumb);
                      setFile(null);
                      setThumb("");
                    }}
                    className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white shadow"
                    aria-label={L("移除", "Remove")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-field border-[1.5px] border-dashed border-c-border2 bg-c-subtle2 text-c-text3 transition-colors hover:border-acc hover:text-acc"
                >
                  <Upload className="h-4 w-4" />
                  <span className="text-[10px]">{L("上传", "Upload")}</span>
                </button>
              )}
            </div>

            {/* 产品描述/卖点 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[12.5px] font-medium text-c-text2">
                  {L("产品描述 / 卖点", "Description / selling points")}
                </p>
                <div className="flex items-center gap-2">
                  {idea.trim() && (
                    <button
                      type="button"
                      onClick={() => openAssist("optimize")}
                      className="inline-flex items-center gap-1 rounded-md bg-acc-tint px-2 py-1 text-[11.5px] font-medium text-acc hover:brightness-95"
                    >
                      <Sparkles className="h-3 w-3" />
                      {L("智能优化", "Optimize")}
                    </button>
                  )}
                  <button
                    ref={assistBtnRef}
                    type="button"
                    onClick={() => openAssist("write")}
                    className="flex items-center gap-1 text-[12px] font-medium text-acc hover:underline"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    {L("AI帮写", "AI write")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTpl(true)}
                    className="flex items-center gap-1 text-[12px] font-medium text-acc hover:underline"
                  >
                    <LayoutTemplate className="h-3.5 w-3.5" />
                    {L("选择模板", "Templates")}
                  </button>
                </div>
              </div>
              <PromptAssistPopup
                open={assistOpen}
                onClose={() => setAssistOpen(false)}
                anchorRef={assistBtnRef}
                tool="titles"
                currentPrompt={idea}
                imageFile={file}
                imageThumb={thumb}
                run={assistRun}
                onUse={(t) => setIdea(t)}
              />
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={4}
                placeholder={L(
                  "例如:东北人参口服液,30ml,提神补气,适合熬夜上班族,礼盒装。",
                  "e.g. Ginseng oral liquid, 30ml, boosts energy, for office workers, gift box."
                )}
                className="w-full resize-none rounded-field border border-c-border bg-c-card px-3 py-2.5 text-[13px] leading-relaxed text-c-text focus:border-acc focus:outline-none"
              />
            </div>

            {/* 平台 */}
            <div>
              <p className="mb-2 text-[12.5px] font-medium text-c-text2">
                {L("平台", "Platform")}
              </p>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => {
                  const active = platform === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlatform(p.id)}
                      style={optStyle(active)}
                      className={cn(
                        "rounded-[8px] border px-3 py-1.5 text-[12px] font-medium",
                        optClass(active)
                      )}
                    >
                      {L(p.zh, p.en)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 输出语言 */}
            <div>
              <p className="mb-2 text-[12.5px] font-medium text-c-text2">
                {L("输出语言", "Language")}{" "}
                <span className="text-[11px] font-normal text-c-text3">
                  {L("(跨境选英文)", "(English for cross-border)")}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                {LANGS.map((lg) => {
                  const active = lang === lg.id;
                  return (
                    <button
                      key={lg.id}
                      type="button"
                      onClick={() => setLang(lg.id)}
                      style={optStyle(active)}
                      className={cn(
                        "rounded-[8px] border px-3 py-1.5 text-[12px] font-medium",
                        optClass(active)
                      )}
                    >
                      {L(lg.zh, lg.en)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 风格 */}
            <div>
              <p className="mb-2 text-[12.5px] font-medium text-c-text2">
                {L("风格", "Style")}
              </p>
              <div className="flex flex-wrap gap-2">
                {STYLES.map((s) => {
                  const active = style === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStyle(s.id)}
                      style={optStyle(active)}
                      className={cn(
                        "rounded-[8px] border px-3 py-1.5 text-[12px] font-medium",
                        optClass(active)
                      )}
                    >
                      {L(s.zh, s.en)}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        }
      >
        {() => (
          <div className="flex min-h-0 flex-1 flex-col">
            {loading ? (
              <div className="relative min-h-[300px] w-full flex-1">
                <GenLoader />
              </div>
            ) : titles.length > 0 ? (
              <div className="flex-1 space-y-4 overflow-y-auto pr-0.5">
                <div className="space-y-2">
                  {titles.map((tt, i) => (
                    <div
                      key={i}
                      className="group flex items-start gap-2 rounded-field border border-c-border bg-c-subtle p-3"
                    >
                      <span className="mt-0.5 flex-none font-mono text-[12px] text-c-text3">
                        {i + 1}
                      </span>
                      <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-c-text">
                        {tt}
                      </p>
                      <button
                        type="button"
                        onClick={() => copy(tt, `t-${i}`)}
                        className="flex-none rounded-[8px] p-1.5 text-c-text3 transition-colors hover:bg-c-subtle2 hover:text-c-text"
                        title={L("复制", "Copy")}
                      >
                        {copied === `t-${i}` ? (
                          <Check className="h-4 w-4 text-acc" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                {points.length > 0 && (
                  <div>
                    <p className="mb-2 text-[12px] font-medium text-c-text3">
                      {L("卖点短语(点即复制)", "Selling points (tap to copy)")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {points.map((p, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => copy(p, `p-${i}`)}
                          className="inline-flex items-center gap-1 rounded-full border border-c-border bg-c-subtle px-3 py-1.5 text-[12px] text-c-text2 transition-colors hover:border-acc hover:text-acc"
                        >
                          {copied === `p-${i}` ? (
                            <Check className="h-3 w-3 text-acc" />
                          ) : (
                            <Copy className="h-3 w-3 opacity-50" />
                          )}
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {thumb && (
                  <div className="flex justify-center pt-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumb}
                      alt={L("原图", "Original")}
                      className="max-h-[300px] max-w-full rounded-field border border-c-border object-contain"
                    />
                  </div>
                )}
              </div>
            ) : (
              <ToolDemo {...getDemo("titles")!} />
            )}
          </div>
        )}
      </ToolShell>

      {/* 选择模板:按电商平台填字段脚手架 + 切换平台/语言 */}
      {showTpl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,13,16,.45)] p-4"
          onClick={() => setShowTpl(false)}
        >
          <div
            className="flex max-h-[80vh] w-[min(560px,94vw)] flex-col overflow-hidden rounded-card border border-c-border bg-c-card shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-c-border px-5 py-4">
              <h2 className="text-[16px] font-bold text-c-text">
                {L("选择模板", "Choose a template")}
              </h2>
              <button
                type="button"
                onClick={() => setShowTpl(false)}
                aria-label={L("关闭", "Close")}
                className="flex h-8 w-8 items-center justify-center rounded-full text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
              {TEMPLATES.map((tp) => (
                <div
                  key={tp.id}
                  className="flex items-start justify-between gap-3 rounded-field border border-c-border bg-c-subtle p-3.5"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] font-semibold text-c-text">
                      {tp.name}
                      <span className="rounded bg-c-subtle2 px-1.5 py-0.5 text-[10px] font-normal text-c-text3">
                        {tp.lang}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-c-text3">{tp.note}</p>
                    <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-c-text3">
                      {tp.scaffold}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIdea(tp.scaffold);
                      setPlatform(tp.platform);
                      setLang(tp.lang);
                      setShowTpl(false);
                    }}
                    className="flex-none rounded-[8px] bg-acc px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:brightness-95"
                  >
                    {L("使用此模板", "Use")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
