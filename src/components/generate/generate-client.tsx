"use client";

import { fetchJobStatus } from "@/lib/poll-job";
import { useArtworkKeepDays, keepNote } from "@/lib/use-keep-days";
import { cdnUrl } from "@/lib/cdn";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  Sparkles,
  Download,
  RefreshCw,
  Upload,
  X,
  Wand2,
  ChevronRight,
  ChevronLeft,
  Clock,
  Trash2,
  Check,
} from "lucide-react";
import { RatioTileGroup } from "@/components/ui/ratio-tile";
import { Segmented } from "@/components/ui/segmented";
import {
  CATEGORY_LABELS,
  GENERATION_RATIOS,
  GENERATION_RESOLUTIONS,
  GENERATION_QUALITIES,
  IMAGE_MODELS,
  GENERATION_STYLES,
  resolutionCost,
  modelResolutions,
  modelHasQuality,
  estimateGenSeconds,
  humanSeconds,
  type Category,
  type PromptTemplate,
} from "@/lib/mock-data";
import type { GeneratedImage } from "@/app/api/generate-image/route";
import { authHeader } from "@/lib/supabase";
import { useAuth, type SessionUser } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PromptAssistPopup } from "@/components/tools/prompt-assist-popup";
import { SelectMenu } from "@/components/ui/select-menu";
import { Media } from "@/components/media";
import { GenLoader } from "@/components/gen-loader";
import { ImageLightbox } from "@/components/image-lightbox";
import { RecordPager, RECORDS_PER_PAGE } from "@/components/tools/record-pager";
import { ToolDemo, getDemo } from "@/components/tools/tool-demo";
import { useToast } from "@/components/ui/toast";
import { useAwayAlert } from "@/lib/notify";
import { useStickyState } from "@/lib/use-sticky-state";
import { downloadImage } from "@/lib/download";
import { useI18n } from "@/lib/i18n/locale-context";
import { cn } from "@/lib/utils";
import { isUserOutput } from "@/lib/artwork-filter";
import { PromptPanel } from "@/components/ui/prompt-panel";
import { useBrand } from "@/lib/brand-context";

function fmt(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    s
  );
}

const RATIO_ASPECT: Record<string, string> = {
  // "auto" lets the model decide; preview a square slot while it's still loading.
  auto: "aspect-square",
  "1:1": "aspect-square",
  "3:4": "aspect-[3/4]",
  "4:3": "aspect-[4/3]",
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
};

const MAX_UPLOAD = 12 * 1024 * 1024;
// 参考图张数。**别再往上加**:gpt-image 编辑接口硬上限 16 张,香蕉(Gemini 3 Pro Image)
// 官方写「最多 14 张效果最佳」——10 是两家都留足缓冲的公约数,再往上主体一致性反而会被稀释。
// 客户(视觉生产公司)日常传 8 张起,10 张覆盖需求还有余量。
const MAX_IMAGES = 10;
// 合计体积上限。**不压缩是用户明确要求**(保参考图原始细节),所以只能靠总量兜底:
// 国内站要把图跨境传到境外代跑,体积直接等于等待时间,不设上限会传到超时。
const MAX_TOTAL = 80 * 1024 * 1024;
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

export function GenerateClient({
  seedTemplateId,
}: {
  seedTemplateId?: string;
} = {}) {
  const { name: brandName } = useBrand(); // 下载文件名用站点名(白标)
  const params = useSearchParams();
  const router = useRouter();
  const { user, ready, remaining, consumeCredits, applyServerUser } =
    useAuth();
  const { openAuth } = useAuthModal();
  const { t, te, locale } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState("");
  // 来自 AI 抠图「换背景」(?bg=1):提示词框换成换背景引导占位文案。
  const [bgMode, setBgMode] = useState(false);
  // AI 创作助手面板:开关 + 触发(点按钮时 nonce 变化 → 面板跑一次,结果进历史不覆盖)
  const [assistOpen, setAssistOpen] = useState(false);
  const assistBtnRef = useRef<HTMLButtonElement>(null);
  const [assistRun, setAssistRun] = useState<{
    mode: "write" | "optimize";
    nonce: number;
  } | null>(null);
  const [category, setCategory] = useState<Category>("main");
  // ── 以下参数「记住上次的选择」(存本机 localStorage,见 use-sticky-state)──
  // 专业用户每天固定用同一套参数,每次进来重选很烦。**都带校验**:
  // 存的值若已失效(模型下架、该模型不再支持某分辨率)自动回落默认,不会卡死。
  const [ratio, setRatio] = useStickyState("gen.ratio", "auto", (v) =>
    GENERATION_RATIOS.some((r) => r.id === v)
  );
  const [resolution, setResolution] = useStickyState("gen.resolution", "1K", (v) =>
    GENERATION_RESOLUTIONS.some((r) => r.id === v)
  );
  // 出图质量档(基础/标准/高阶)。**2026-08-15 恢复可选** —— 之前锁死 medium 省成本,
  // 专业视觉客户一眼看出质感差距(见客户反馈)。高阶更贵,价格按 qualityMult 走。
  const [quality, setQuality] = useStickyState("gen.quality", "medium", (v) =>
    GENERATION_QUALITIES.some((q) => q.id === v)
  );
  // 生图模型:用户自选(GPT Image 2 / Nano Banana),不同调性各有强项。
  // 校验放宽到"任意非空字符串":自定义模型名不在内置表里;不可用的由下面的回落逻辑兜住。
  const [model, setModel] = useStickyState<string>("gen.model", IMAGE_MODELS[0].id, (v) =>
    typeof v === "string" && v.length > 0
  );
  // 本实例是否配了香蕉(Gemini)。云端租户只有 relay 注入的 OpenAI 通道、没有 GEMINI_*,
  // 全列出来的话客户选了香蕉、传完图、等完进度条,最后才拿到「Nano Banana 未配置」。
  // 默认 true:接口没答上来之前先按"全都有"渲染,避免主站闪一下少两个按钮。
  const [geminiOk, setGeminiOk] = useState(true);
  const [fluxOk, setFluxOk] = useState(true);
  // 后台「自定义生图模型」:配了就整体替换模型按钮(接第三方中转,模型名由站长填)
  const keepDays = useArtworkKeepDays();
  const [customModels, setCustomModels] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setGeminiOk(!!d.geminiEnabled);
        setFluxOk(!!d.fluxEnabled);
        if (Array.isArray(d.customImageModels)) setCustomModels(d.customImageModels);
      })
      .catch(() => {});
  }, []);
  const availableModels = useMemo<{ id: string; label: string; hint?: string }[]>(
    () =>
      customModels.length > 0
        ? customModels
        : IMAGE_MODELS.filter((m) => {
            if (m.provider === "gemini") return geminiOk;
            if (m.provider === "replicate") return fluxOk;
            return true;
          }),
    [geminiOk, fluxOk, customModels]
  );
  const isCustomModel = customModels.some((m) => m.id === model);
  // 记住的模型若在本实例不可用(换实例/配置变了),回落到第一个可用的,
  // 否则会停在一个点了必失败的选项上。
  useEffect(() => {
    if (!availableModels.some((m) => m.id === model)) {
      setModel(availableModels[0]?.id ?? IMAGE_MODELS[0].id);
    }
  }, [availableModels, model, setModel]);
  const [style, setStyle] = useState(GENERATION_STYLES[0]);
  const [count, setCount] = useStickyState("gen.count", 1, (v) => [1, 2, 4].includes(v));
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  // 生成中已经出好的图(出一张显示一张;完成后并入 images)
  const [liveImages, setLiveImages] = useState<GeneratedImage[]>([]);
  const [viewing, setViewing] = useState<GeneratedImage | null>(null);
  const [baseNotice, setBaseNotice] = useState(false);
  // 右栏「本工具记录」折叠态;结果筛选(全部/已完成)。
  const [historyOpen, setHistoryOpen] = useState(true);
  const [recPage, setRecPage] = useState(0);
  const [resultFilter, setResultFilter] = useState<"all" | "done">("all");
  // 移动端单列:参数/结果 分段切换(桌面忽略,始终三栏)。
  const [mobileTab, setMobileTab] = useState<"params" | "result">("params");
  // 生成用时(秒),给「不知道跑到哪了」的用户一个在动的读数。
  const [elapsed, setElapsed] = useState(0);
  // 参考图拖拽高亮
  const [dragOver, setDragOver] = useState(false);
  const { toast } = useToast();
  const away = useAwayAlert();
  // 右栏「本工具记录」:登录后拉最近作品(生成产物),点击载入中间对比区。纯展示,不碰生成逻辑。
  type RecItem = {
    id: string;
    url: string;
    prompt?: string;
    gradient?: string;
    source?: string;
    // 客户要能回答「这张什么时候生成的、什么参数、扣了几分」(2026-08-17 客户质疑扣分)。
    createdAt?: string;
    cost?: number | null;
    resolution?: string | null;
    quality?: string | null;
    model?: string | null;
    ratio?: string | null;
  };
  const [records, setRecords] = useState<RecItem[] | null>(null);
  // 记录列多选(批量打包下载) + 点记录在中间载入的「原图/成品对比」(null=显示当前结果)。
  const [recSel, setRecSel] = useState<Set<string>>(new Set());
  const [shownRec, setShownRec] = useState<RecItem | null>(null);
  const [recZipping, setRecZipping] = useState(false);
  // 血缘:当前底图对应的作品 id(图生图来源),生成时作为新图的 parent_id。空=根图。
  const [parentId, setParentId] = useState("");
  // 来自模板库「做同款」:记下模板 id/图/提示词,生成时让服务端把"模板原图"作为血缘根。
  const [tpl, setTpl] = useState<
    { id: string; image: string; prompt: string; name?: string } | null
  >(null);
  // 已加载/在载的底图 URL(去重):防止 useSearchParams 水合后偶发返回新实例 →
  // effect 重跑把在途的大图下载误取消,导致产品图(底图)时灵时不灵。
  const baseLoadRef = useRef<string>("");

  // 把一张远程图(模板原图 / 作品库源图或上一版)下载进左侧「产品图(底图)」。
  // 按 URL 去重:同 URL 只下载一次(重跑直接跳过,不会取消在途的大图);
  // 失败/出错把 ref 清空允许重试;下载完若已切到别的图则丢弃结果。
  const loadBaseImage = useCallback(async (url: string, name = "base.png") => {
    if (!url || baseLoadRef.current === url) return;
    baseLoadRef.current = url;
    try {
      const res = await fetch(
        `/api/download?u=${encodeURIComponent(url)}&n=${encodeURIComponent(name)}`
      );
      if (!res.ok) {
        if (baseLoadRef.current === url) baseLoadRef.current = "";
        return;
      }
      const blob = await res.blob();
      if (baseLoadRef.current !== url) return; // 期间已切换到别的图
      const file = new File([blob], name, { type: blob.type || "image/png" });
      setFiles([file]);
      setFilePreviews([URL.createObjectURL(file)]);
    } catch {
      if (baseLoadRef.current === url) baseLoadRef.current = "";
    }
  }, []);

  // When ?template= is present, fetch the template (DB-backed) and seed its
  // prompt/category/image as the reference for comparison.
  useEffect(() => {
    const tplId = params.get("template") || seedTemplateId;
    if (!tplId) return;
    let cancelled = false;
    (async () => {
      try {
        // /api/templates 是分页接口 (默认 page=1&pageSize=24); 用 ids 参数
        // 精确拉单条,否则页 2 以后的模板会找不到 (silent fail)。
        const res = await fetch(
          `/api/templates?ids=${encodeURIComponent(tplId)}&pageSize=1`,
          { cache: "no-store" }
        );
        const data = await res.json();
        const list = (data.templates ?? []) as PromptTemplate[];
        const tpl = list.find((t) => t.id === tplId);
        if (!tpl || cancelled) return;
        setPrompt(tpl.prompt);
        // 记下模板信息,生成时让服务端把"模板原图"作为血缘根节点
        setTpl({ id: tpl.id, image: tpl.image, prompt: tpl.prompt, name: tpl.title });
        const catKey = (Object.keys(CATEGORY_LABELS) as Category[]).find(
          (k) => CATEGORY_LABELS[k] === tpl.category
        );
        if (catKey) setCategory(catKey);
        // 模板成品图放右侧当「参考/对比」。
        setImages([
          {
            id: `tpl-${tpl.id}`,
            url: tpl.image,
            gradient: tpl.gradient,
            prompt: tpl.prompt,
            ratio: "4:3",
            createdAt: new Date().toISOString(),
          },
        ]);
        // 做同款:若模板带了白底原图(作品转模板时存的 sourceImage)→ 载入左侧产品图,
        // 让用户在白底原图上直接做同款;库模板没有 sourceImage 则产品图留空、自行上传。
        if (tpl.sourceImage && /^https?:\/\//.test(tpl.sourceImage)) {
          setParentId(""); // 模板原图是血缘根
          void loadBaseImage(tpl.sourceImage, "template.png");
        }
      } catch {
        /* swallow — keep current state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, seedTemplateId, loadBaseImage]);

  useEffect(() => {
    // Restore from a works-library item: prompt + 选项全还原。
    const qp = params.get("prompt");
    if (qp) setPrompt(qp);
    const qc = params.get("category");
    if (qc && qc in CATEGORY_LABELS) setCategory(qc as Category);
    const qs = params.get("style");
    if (qs) setStyle(qs);
    const qr = params.get("ratio");
    if (qr && qr in RATIO_ASPECT) setRatio(qr);
    const qres = params.get("resolution");
    if (qres && GENERATION_RESOLUTIONS.some((r) => r.id === qres))
      setResolution(qres);

    // 血缘:从作品页带来的 from=<作品id> 作为本次迭代的父节点。
    setParentId(params.get("from") ?? "");
    // AI 抠图「换背景」入口:提示词框给换背景引导(占位)。
    setBgMode(params.get("bg") === "1");

    // Seed the previous result into the canvas so new generations append
    // after it for side-by-side comparison.
    const gen = params.get("gen");
    if (gen) {
      setImages([
        {
          id: `prev-${Date.now()}`,
          url: gen,
          gradient: "from-slate-100 to-zinc-100",
          prompt: qp || "",
          ratio: qr && qr in RATIO_ASPECT ? qr : "1:1",
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    // 图生图底图:优先用原始上传的产品图(src);没有就退而用上一版生成结果(gen)。
    // 这样从作品页点「在此基础上再次生成」时,会真的把那张图当参考做图生图修改,
    // 而不是无参考地纯文生图(否则会出一张毫无关联的图)。按 URL 去重下载,避免大图被误取消。
    void loadBaseImage(params.get("src") || gen || "");
  }, [params, loadBaseImage]);

  // 组件卸载时释放所有 blob 预览地址。
  // ⚠️ **依赖数组必须是空的**(2026-08-18 修):原来写的是 [filePreviews],
  // 于是每次数组一变(加第二张图),React 会先跑上一次的清理 —— 把**上一批地址全部
  // revoke 掉**,包括第一张还在用的那个。缩略图因为浏览器已缓存看着正常,
  // 但点开灯箱要重新加载时就是裂图,表现为"只有第一张图放大打不开"。
  // 用 ref 持有最新数组,这样空依赖也能在卸载时拿到全部地址。
  const previewsRef = useRef<string[]>([]);
  useEffect(() => {
    previewsRef.current = filePreviews;
  }, [filePreviews]);
  useEffect(() => {
    return () => {
      previewsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  // Ctrl+V 直接粘贴图片上传(专业用户常截图后直接粘)。
  // 只在没聚焦在输入框时接管,免得粘提示词文本时被误吞。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imgs: File[] = [];
      for (const it of Array.from(items)) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) imgs.push(f);
        }
      }
      if (!imgs.length) return;
      e.preventDefault();
      const dt = new DataTransfer();
      imgs.forEach((f) => dt.items.add(f));
      pickFiles(dt.files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  // 生成用时秒表:loading 期间每秒 +1,结束归零。
  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // 拉「本工具记录」:登录后取最近作品;每次生成完(images 变)刷新一次。
  useEffect(() => {
    if (!user?.email) {
      setRecords(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/account?email=${encodeURIComponent(user.email)}`,
          { headers: await authHeader() }
        );
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const arts = (d.artworks ?? []) as {
          id: string;
          image: string;
          prompt?: string;
          gradient?: string;
          status?: string;
          source?: string;
          templateId?: string | null;
          createdAt?: string;
          cost?: number | null;
          resolution?: string | null;
          quality?: string | null;
          model?: string | null;
          ratio?: string | null;
        }[];
        if (cancelled) return;
        setRecords(
          arts
            // 只留**本工具真正生成出来的结果**。账户下还混着两类"素材",它们也是
            // app_artworks 行,但不是用户产出,列在「本工具记录」里会让人以为是自己生成的:
            //   · 模板原图(templateId 非空)—— 模板自带的参考图,「做同款」时建的血缘根节点;
            //   · 上传图(无提示词)—— 用户自己拖进来的底图/参考图。
            .filter(isUserOutput)
            .slice(0, 60)
            .map((a) => ({
              id: a.id,
              url: a.image,
              prompt: a.prompt,
              gradient: a.gradient,
              source: a.source,
              createdAt: a.createdAt,
              cost: a.cost,
              resolution: a.resolution,
              quality: a.quality,
              model: a.model,
              ratio: a.ratio,
            }))
        );
        setRecPage(0);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email, images.length]);


  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  function pickFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const slotsLeft = MAX_IMAGES - files.length;
    if (slotsLeft <= 0) {
      setError(`最多上传 ${MAX_IMAGES} 张产品图`);
      return;
    }
    const accepted: File[] = [];
    // 已选体积,新加的要累加着算 —— 不压缩时**容量往往先于张数触顶**,
    // 所以拦下来时必须按容量说话,否则用户会以为"说好 10 张却只让传 8 张"。
    let total = files.reduce((s, f) => s + f.size, 0);
    let hitCap = false;
    for (const f of Array.from(list)) {
      if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) {
        setError("仅支持 PNG / JPG / WebP 图片");
        continue;
      }
      if (f.size > MAX_UPLOAD) {
        setError("单张图片过大，请小于 12MB");
        continue;
      }
      if (total + f.size > MAX_TOTAL) {
        hitCap = true;
        break;
      }
      total += f.size;
      accepted.push(f);
      if (accepted.length >= slotsLeft) break;
    }
    if (hitCap) {
      setError(
        `参考图合计不能超过 ${mb(MAX_TOTAL)}MB（当前 ${mb(total)}MB）。` +
          `已加入 ${accepted.length} 张，其余请分批生成或改用更小的图。`
      );
    }
    if (accepted.length === 0) return;
    if (!hitCap) setError(null); // 触顶提示要留着,别被这行清掉
    setParentId(""); // 手动上传的底图是新根,没有血缘父节点
    setTpl(null); // 也不再算模板「做同款」
    setFiles((prev) => [...prev, ...accepted]);
    setFilePreviews((prev) => [
      ...prev,
      ...accepted.map((f) => URL.createObjectURL(f)),
    ]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeFile(index: number) {
    setFilePreviews((prev) => {
      const u = prev[index];
      if (u) URL.revokeObjectURL(u);
      return prev.filter((_, i) => i !== index);
    });
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) setParentId(""); // 底图清空 → 无血缘来源
      return next;
    });
  }

  // 点结果图 → 把它下载下来设为左侧"产品图"底图,下次生成在它基础上做图生图修改。
  // 通过 /api/download 代理避开跨域;成功后左侧缩略图即更新为这张图。
  // 同时解析这张图对应的作品 id 作为血缘父节点:gen-*=真·已生成作品;
  // prev-*=入口作品(用 from);tpl-*/其它=无对应用户作品,父为空。
  async function loadImageAsBase(image: GeneratedImage) {
    let pid = "";
    if (image.id.startsWith("gen-")) pid = image.id;
    else if (image.id.startsWith("prev-")) pid = params.get("from") ?? "";
    try {
      const res = await fetch(
        `/api/download?u=${encodeURIComponent(image.url)}&n=base.png`
      );
      if (!res.ok) return;
      const blob = await res.blob();
      const f = new File([blob], "base.png", {
        type: blob.type || "image/png",
      });
      setFiles([f]);
      setFilePreviews([URL.createObjectURL(f)]);
      setParentId(pid);
      setBaseNotice(true);
      window.setTimeout(() => setBaseNotice(false), 2600);
    } catch {
      /* ignore — 失败则底图不变 */
    }
  }

  function toggleRecSel(id: string) {
    setRecSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // 批量打包下载选中记录(走 /api/suite/download zip;失败回退逐张)。
  async function downloadRecSelected() {
    const items = (records ?? [])
      .filter((r) => recSel.has(r.id))
      .map((r, i) => ({ url: r.url, name: `生图-${i + 1}` }));
    if (!items.length) return;
    setRecZipping(true);
    try {
      const res = await fetch("/api/suite/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("zip failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `生图-${items.length}张.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      items.forEach((it, i) =>
        setTimeout(() => downloadImage(it.url, it.name), i * 350)
      );
    } finally {
      setRecZipping(false);
    }
  }

  // 点 AI帮写 / 智能优化 → 打开右侧"AI 创作助手"面板并触发一次(结果进历史,不覆盖输入框)。
  function openAssist(mode: "write" | "optimize") {
    if (!user) {
      if (ready) openAuth("sign-up");
      return;
    }
    if (mode === "optimize" && !prompt.trim()) {
      setError(t("gen.optimizeEmpty"));
      return;
    }
    // AI帮写:既没产品图也没任何想法 → 别让模型凭空编产品,提示先写点字或传图
    if (mode === "write" && !prompt.trim() && !files[0]) {
      setError(t("gen.assistNeedInput"));
      return;
    }
    setError(null);
    setAssistRun({ mode, nonce: Date.now() });
    setAssistOpen(true);
  }

  // 当前模型支持哪些分辨率 / 有没有质量档(Lite 只有 1K;Gemini 系无质量档)
  // 自定义模型(第三方中转)按 GPT生图 的能力与价格表处理,和后端口径一致
  const capModel = isCustomModel ? "gpt-image-2" : model;
  const allowedRes = modelResolutions(capModel);
  // 自定义模型不提供出图质量选择:第三方中转是否按质量档出图/计价无法确认,统一按标准档
  const hasQuality = !isCustomModel && modelHasQuality(capModel);
  // 切到能力更窄的模型时,把非法选择拉回合法值,避免带着 4K 去点 Lite 直接报错。
  useEffect(() => {
    if (!allowedRes.includes(resolution)) setResolution(allowedRes[0]);
    if (!hasQuality && quality !== "medium") setQuality("medium");
  }, [allowedRes, hasQuality, resolution, quality]);
  // 计价:没有质量档的模型一律按标准档算 —— 否则用户选了高阶白付 4 倍钱。
  // 单价随模型变(各模型上游成本差好几倍),不能只看分辨率。
  const costPerImage = resolutionCost(
    resolution,
    hasQuality ? quality : "medium",
    capModel
  );
  // 预计耗时:4K/高阶是分钟级,必须提前告诉用户,否则会以为卡死。
  const etaSec = estimateGenSeconds(resolution, hasQuality ? quality : "medium", count);
  const cost = count * costPerImage;
  const insufficient = !!user && remaining < cost;

  async function generate() {
    // 未登录:直接弹登录/注册窗(优先于提示词等校验),登录后再生成。
    if (!user) {
      if (ready) openAuth("sign-up");
      return;
    }
    if (!prompt.trim()) {
      setError(t("gen.errPrompt"));
      return;
    }
    if (remaining < cost) {
      setError(
        fmt(t("gen.errInsufficient"), {
          r: remaining,
          n: count,
          c: cost,
          res: resolution,
          cp: costPerImage,
        })
      );
      return;
    }
    setError(null);
    setLoading(true);
    // 手机上默认停在「参数」tab,不切过去用户看不到结果区的生成动画/结果。
    setMobileTab("result");
    // 在这次点击(用户手势)里礼貌请求一次通知权限,供后台完成时提醒;拒绝也有标题兜底。
    away.askPermission();
    try {
      const fd = new FormData();
      fd.append("prompt", prompt);
      // 落库明确只存用户原始提示词(生图页 prompt 本就是用户输入框内容)
      fd.append("userPrompt", prompt);
      fd.append("category", category);
      fd.append("ratio", ratio);
      fd.append("resolution", resolution);
      fd.append("quality", quality);
      fd.append("model", model);
      fd.append("style", style);
      fd.append("count", String(count));
      fd.append("email", user.email);
      if (parentId) fd.append("parentId", parentId);
      // 无显式父节点 + 来自模板「做同款」→ 传模板信息,服务端建/接"模板原图"根
      else if (tpl) {
        fd.append("templateId", tpl.id);
        fd.append("templateImage", tpl.image);
        fd.append("templatePrompt", tpl.prompt);
      }
      files.forEach((f) => fd.append("image", f));

      // Kick off an async job (returns instantly), then poll for the result.
      // Keeps every HTTP request short so slow generations never hit the CDN's
      // ~100s proxy timeout.
      const startRes = await fetch("/api/generate-image", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const start = await startRes.json();
      if (!startRes.ok) throw new Error(start.error ?? t("gen.errFail"));
      const jobId: string | undefined = start.jobId;
      if (!jobId) throw new Error(t("gen.errNoJob"));

      setLiveImages([]);
      const deadline = Date.now() + 6 * 60 * 1000;
      let data: {
        images: GeneratedImage[];
        user?: SessionUser | null;
      } | null = null;
      while (!data) {
        await new Promise((r) => setTimeout(r, 2500));
        if (Date.now() > deadline) throw new Error(t("gen.errTimeout"));
        const s = await fetchJobStatus(`/api/generate-image?job=${encodeURIComponent(jobId)}`);
        if (s.status === "done") data = s;
        else if (s.status === "error")
          throw new Error(s.error ?? t("gen.errFail"));
        // 生成中:已出好的几张先显示(服务端出一张推一张)
        else if (Array.isArray(s.partial)) setLiveImages(s.partial);
      }

      if (data.user) applyServerUser(data.user);
      else consumeCredits(cost);
      // Append after existing results (incl. the seeded previous version)
      // so the user can compare iterations side by side.
      setImages((prev) => [...prev, ...data!.images]);
      setShownRec(null); // 新结果出来 → 回到当前结果视图
      // 完成提醒:前台弹 toast;若此刻页面在后台(用户切走了),改标题+系统通知带回来。
      const doneMsg = fmt(t("gen.doneToast"), { n: data.images.length });
      toast(doneMsg, "success");
      away.fire(doneMsg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("gen.errFailRetry");
      setError(msg);
      toast(msg, "error");
    } finally {
      setLoading(false);
      setLiveImages([]);
    }
  }

  return (
    <div className="w-full px-5 py-6 sm:px-6 lg:px-8">
      <div className="w-full">
        <div className="relative mb-4">
          {/* 面包屑:创作工具 › AI 生图(与其它工具页一致,独占一行) */}
          <nav className="flex items-center gap-1.5 text-[13px]">
            <Link
              href="/tools"
              className="text-c-text3 transition-colors hover:text-c-text"
            >
              创作工具
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-c-text4" />
            <span className="font-semibold text-c-text">AI 生图</span>
          </nav>
          {/* 模式切换:工作台 / 对话 —— 桌面浮于面包屑右端,不撑高这一行;移动端排在下方 */}
          <div className="mt-3 flex w-fit gap-0.5 rounded-[10px] bg-c-track p-[3px] sm:absolute sm:right-0 sm:top-1/2 sm:mt-0 sm:-translate-y-1/2">
            <span className="rounded-[7px] bg-c-card px-3 py-1.5 text-[12.5px] font-semibold text-c-text shadow-[0_1px_2px_rgba(16,18,23,.06)]">
              {t("genchat.modeWork")}
            </span>
            <Link
              href="/genchat"
              className="rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold text-c-seg-inactive transition-colors hover:text-c-text2"
            >
              {t("genchat.modeChat")}
            </Link>
          </div>
        </div>

        {/* 视频生成**不在这一页** —— 用户 2026-08-15 拍板:只在画布里做
            (画布里已有现成的图片节点当首帧,图生视频更顺;生图页保持纯图片工作台)。
            VideoStudio 组件保留未挂载,以后若要独立视频页可直接复用。 */}
        {/* 移动端「参数 / 结果」分段切换(桌面隐藏,始终三栏) */}
        <div className="mb-3 lg:hidden">
          <Segmented<"params" | "result">
            value={mobileTab}
            onChange={setMobileTab}
            options={[
              { value: "params", label: "参数" },
              { value: "result", label: "结果" },
            ]}
          />
        </div>
        <div
          className={cn(
            "grid gap-5 lg:h-[890px] lg:grid-cols-[320px_1fr]",
            historyOpen
              ? "xl:grid-cols-[320px_1fr_280px]"
              : "xl:grid-cols-[320px_1fr_46px]"
          )}
        >
          {/* Control panel — Rodin 紧凑式(下拉参数) */}
          <div
            className={cn(
              // flex-col + 底部块 mt-auto:左栏是固定 890px 高,内容不足时
              // 让生成按钮贴底,而不是把空白堆在参数区与按钮之间。
              "flex h-fit flex-col gap-4 rounded-card border border-c-border bg-c-card p-5 shadow-card nv-panel-scroll lg:h-full lg:min-h-0 lg:overflow-y-auto",
              mobileTab === "result" && "hidden lg:block"
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => pickFiles(e.target.files)}
            />
            {/* 工具头:图标 + 名称 + 描述(与其它工具页一致) */}
            <div className="flex items-center gap-3">
              <span
                className="grid h-11 w-11 flex-none place-items-center rounded-[10px]"
                style={{ background: "rgba(79,70,229,.12)", color: "#4F46E5" }}
              >
                <Sparkles className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <h1 className="text-[16px] font-bold text-c-text">AI 生图</h1>
                <p className="text-[12px] text-c-text3">
                  文字描述或产品图,一键生成电商视觉
                </p>
              </div>
            </div>
            {/* 参考图。**整块可拖拽** —— 不只是那个小加号按钮:专业用户习惯从
                资源管理器直接拖一批图进来,只在 64px 小方块上接 drop 等于没有。 */}
            <div
              className="space-y-2"
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                // 只有真正离开这块区域才取消高亮(移到子元素上会误触发 leave)
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setDragOver(false);
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDragOver(false);
                pickFiles(e.dataTransfer.files);
              }}
            >
              <label className="flex items-baseline justify-between gap-2 text-sm font-medium">
                <span>{fmt(t("gen.uploadLabel"), { n: MAX_IMAGES })}</span>
                {/* 不压缩 → 容量常常比张数先触顶,得让用户**边传边看到**剩多少,
                    否则只有被拦下的那一刻才知道。 */}
                {files.length > 0 && (
                  <span
                    className={cn(
                      "text-xs font-normal tabular-nums",
                      totalBytes > MAX_TOTAL * 0.8 ? "text-amber-600" : "text-ink3"
                    )}
                  >
                    {files.length}/{MAX_IMAGES} 张 · {mb(totalBytes)}/
                    {mb(MAX_TOTAL)}MB
                  </span>
                )}
              </label>
              <div
                className={cn(
                  "flex flex-wrap gap-2 rounded-xl border-[1.5px] border-dashed p-2 transition-colors",
                  dragOver
                    ? "border-acc bg-acc-tint"
                    : "border-transparent"
                )}
              >
                {filePreviews.map((src, i) => (
                  <div
                    key={src}
                    className="relative h-16 w-16 overflow-hidden rounded-lg border border-border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`${t("gen.removeImage")} ${i + 1}`}
                      onClick={() =>
                        setViewing({
                          id: `base-${i}`,
                          url: src,
                          gradient: "",
                          prompt: t("gen.viewLarge"),
                          ratio: "1:1",
                          createdAt: "",
                        })
                      }
                      title={t("gen.viewLarge")}
                      className="h-full w-full cursor-zoom-in bg-secondary object-cover"
                    />
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-card/90 text-foreground shadow hover:bg-card"
                      aria-label={t("gen.removeImage")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {files.length === 0 && (
                  <span className="pointer-events-none flex h-16 flex-1 items-center px-1 text-[11.5px] leading-snug text-c-text3">
                    点击 + 选择，或把图片拖到这里 / 直接 Ctrl+V 粘贴
                  </span>
                )}
                {files.length < MAX_IMAGES && (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-border bg-secondary/40 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    <Upload className="h-4 w-4" />
                    <span className="text-[10px]">{t("gen.addImage")}</span>
                  </button>
                )}
              </div>
            </div>

            {/* 提示词 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium">{t("gen.promptLabel")}</label>
                <div className="flex items-center gap-1">
                  <button
                    ref={assistBtnRef}
                    type="button"
                    onClick={() => openAssist("write")}
                    disabled={loading}
                    title={t("gen.aiWriteHint")}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition-opacity hover:opacity-80 disabled:opacity-50"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    {t("gen.aiWrite")}
                  </button>
                  {/* 智能优化:提示词有文字才显示(全站统一交互) */}
                  {prompt.trim() && (
                    <button
                      type="button"
                      onClick={() => openAssist("optimize")}
                      disabled={loading}
                      title={t("gen.optimizeHint")}
                      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-opacity hover:text-foreground disabled:opacity-50"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {t("gen.aiOptimize")}
                    </button>
                  )}
                </div>
              </div>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onMouseDown={(e) => {
                  const el = e.currentTarget;
                  if (document.activeElement !== el) {
                    e.preventDefault();
                    el.focus();
                    el.select();
                  }
                }}
                placeholder={bgMode ? t("gen.bgPlaceholder") : t("gen.promptPlaceholder")}
                className="min-h-[110px]"
              />
              {tpl && (
                <div className="flex w-fit items-center gap-1.5 rounded-md bg-acc-tint px-2 py-1 text-[11.5px] font-medium text-acc">
                  {locale === "en" ? "Template: " : "已套用「"}
                  {tpl.name || (locale === "en" ? "applied" : "模板")}
                  {locale === "en" ? "" : "」"}
                  <button
                    type="button"
                    onClick={() => setTpl(null)}
                    aria-label={locale === "en" ? "Remove template" : "移除模板"}
                    className="transition-opacity hover:opacity-70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>

            {/* 控制参数 */}
            <div className="space-y-2.5 border-t border-c-line pt-3">
              {/* 风格选择器已移除(2026-08-17 用户要求):默认档本就是纯透传,
                  多一个下拉框反而干扰。style 仍固定发"默认",后端行为不变。 */}

              {/* 比例:可视化方块 */}
              <div className="space-y-2">
                <span className="text-[13px] text-c-text2">{t("gen.ratioLabel")}</span>
                <RatioTileGroup
                  columns={4}
                  value={ratio}
                  onChange={setRatio}
                  tiles={GENERATION_RATIOS.map((r) => {
                    const max = 26;
                    const w = !r.w || !r.h ? 24 : r.w >= r.h ? max : Math.round((r.w / r.h) * max);
                    const h = !r.w || !r.h ? 18 : r.h >= r.w ? max : Math.round((r.h / r.w) * max);
                    return { id: r.id, label: r.id === "auto" ? "默认" : r.id, w, h };
                  })}
                />
              </div>

              {/* 生图模型:专业客户按项目挑(不同模型调性/强项不同) */}
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-c-text2">生图模型</span>
                  <span className="text-[11.5px] text-c-text3">
                    {availableModels.find((m) => m.id === model)?.hint}
                  </span>
                </div>
                {/* 用按钮组不用下拉(用户要求)。**2x2 网格而不是一行4个** ——
                    左栏 320px 下一行4个只有 64px/个,"GPT生图"四个字必换行。 */}
                <div className="flex flex-wrap gap-1.5">
                  {availableModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModel(m.id)}
                      className={cn(
                        // px-2 而不是 px-2.5:四个 chip 总宽刚好卡在 320px 左栏的可用宽度上,
                        // 多 4px 就换行。改动前实测 287px vs 可用 280px。
                        "whitespace-nowrap rounded-[9px] border px-2 py-1.5 text-[12px] font-semibold leading-none transition-colors",
                        model === m.id
                          ? "border-acc bg-acc-tint text-acc"
                          : "border-c-border2 text-c-text3 hover:border-c-border hover:text-c-text2"
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 出图质量。**只有 OpenAI 系有这个参数** —— Gemini 接口里根本没有
                  quality 字段(实测三种写法全 400),显示出来会让用户选了高阶白付 4 倍钱。
                  ⚠️ 但**不能直接隐藏**:那会让下面的生成按钮上下跳。改成"始终占位",
                  没有质量档时用等高的一行灰字说明,布局纹丝不动。
                  自定义模型(第三方中转)**整栏不显示**:它们全都没有质量档,切换时不会跳。 */}
              {!isCustomModel && (
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-c-text2">出图质量</span>
                  <span className="text-[11.5px] text-c-text3">
                    {hasQuality
                      ? GENERATION_QUALITIES.find((q) => q.id === quality)?.hint
                      : ""}
                  </span>
                </div>
                {hasQuality ? (
                  <Segmented
                    value={quality}
                    onChange={setQuality}
                    options={GENERATION_QUALITIES.map((q) => ({
                      value: q.id,
                      label: q.label,
                    }))}
                  />
                ) : (
                  // 高度与 Segmented 一致(p-[3px] + py-1.5 + 12.5px 行高 ≈ 30px)
                  <div className="flex h-[30px] items-center rounded-[10px] bg-c-track px-3 text-[12px] text-c-text3">
                    该模型无质量档，按标准出图
                  </div>
                )}
              </div>
              )}

              {/* 分辨率 / 数量:分段 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <span className="text-[13px] text-c-text2">{t("gen.resLabel")}</span>
                  <Segmented
                    value={resolution}
                    onChange={setResolution}
                    options={GENERATION_RESOLUTIONS.map((r) => ({
                      value: r.id,
                      label: r.id,
                      // 该模型不支持的档灰掉(如 Lite 只有 1K),点不了 —— 明确告知
                      // 比"帮你偷偷降级"可控,专业客户要的是可预期。
                      disabled: !allowedRes.includes(r.id),
                    }))}
                  />
                  {/* 同样固定占位:这行提示只在部分模型出现,不占位会把生成按钮顶下去。
                      min-h 与一行 11.5px 文字等高。 */}
                  {/* 提示行复用同一处固定占位。**4K 的说明必须给** ——
                      模型有总像素上限(约 800 万),竖版比例下长边到不了 3840:
                      3:4 的 4K 实际是 2480×3296。不说明客户会以为长边有 3840,
                      下载后一量就来质疑(2026-08-25 客户已问过一次)。 */}
                  <p className="min-h-[16px] text-[11.5px] leading-4 text-c-text3">
                    {allowedRes.length < GENERATION_RESOLUTIONS.length
                      ? `该模型仅支持 ${allowedRes.join(" / ")}`
                      : resolution === "4K"
                        ? "4K ≈ 800 万像素;竖版/方图长边约 3300(受模型像素上限)"
                        : ""}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[13px] text-c-text2">{t("gen.count2")}</span>
                  <Segmented
                    value={String(count)}
                    onChange={(v) => setCount(Number(v))}
                    options={[1, 2, 4].map((n) => ({ value: String(n), label: String(n) }))}
                  />
                </div>
              </div>
            </div>

            {/* 剩余积分不在此重复(顶栏右上已显示);未登录时保留登录提示 */}
            {ready && !user && (
              <div className="flex items-center rounded-lg border border-border bg-secondary/60 px-3 py-1.5 text-[11.5px]">
                <span className="text-muted-foreground">
                  {t("gen.loginToSave")}
                </span>
              </div>
            )}

            {/* 生成按钮:与其它功能页(ToolWorkspace)一致的普通分隔区,
                顶部细分隔线 + 按钮,不再是浮动白底卡片。 */}
            <div className="space-y-2 border-t border-c-line pt-2.5">
              {error && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}

              {/* 预计耗时:4K/高阶是分钟级,不提前说用户会以为卡死。
                  超过 3 分钟额外提醒可以切走等通知(完成会改标题+发通知)。 */}
              {!loading && (
                <p className="flex items-center gap-1.5 text-[12px] text-c-text3">
                  <Clock className="h-3.5 w-3.5 flex-none" />
                  <span>
                    {humanSeconds(etaSec)}
                    {etaSec > 180 && "，可先去忙别的，好了会通知你"}
                  </span>
                </p>
              )}

              {insufficient ? (
                <Button
                  asChild
                  variant="gradient"
                  size="lg"
                  className="w-full shadow-btn"
                >
                  <Link href="/account?tab=credits">{t("gen.insufficient")}</Link>
                </Button>
              ) : (
                <Button
                  onClick={generate}
                  disabled={loading}
                  variant="gradient"
                  size="lg"
                  className="w-full shadow-btn"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {loading
                    ? `${t("gen.generating")} ${elapsed}s / ${etaSec}s`
                    : !user
                      ? fmt(t("gen.loginAndGen"), { n: count })
                      : files.length > 0
                        ? fmt(t("gen.genImg2img"), { n: count, c: cost })
                        : fmt(t("gen.genBtn"), { n: count, c: cost })}
                </Button>
              )}
            </div>
          </div>

          {/* Result canvas */}
          <div
            className={cn(
              "flex min-h-[520px] flex-col rounded-card border border-c-border bg-c-card p-5 shadow-card nv-panel-scroll lg:h-full lg:min-h-0 lg:overflow-y-auto",
              mobileTab === "params" && "hidden lg:block"
            )}
          >
            {shownRec ? (
              /* 记录详情:左原图 / 右成品对比 + 提示词(点记录载入,非直接放大) */
              <div className="flex h-full min-h-[440px] flex-col">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold text-c-text">
                    {locale === "en" ? "Record detail" : "记录详情"}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShownRec(null)}
                    className="text-[12.5px] font-medium text-acc hover:underline"
                  >
                    {locale === "en" ? "← Back to current" : "← 返回当前"}
                  </button>
                </div>
                {/* 生成时间 / 当时的参数 / 实扣积分 —— 客户要能自己核对账单
                    (2026-08-17 客户质疑扣分,而界面上当时什么都查不到)。
                    本次改动前生成的老记录没有这些字段,缺哪项就不显示哪项。 */}
                <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11.5px]">
                  {shownRec.createdAt && (
                    <span className="text-c-text3">
                      {new Date(shownRec.createdAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                  {[
                    IMAGE_MODELS.find((m) => m.id === shownRec.model)?.label,
                    shownRec.resolution,
                    shownRec.ratio && shownRec.ratio !== "auto"
                      ? shownRec.ratio
                      : null,
                    GENERATION_QUALITIES.find((q) => q.id === shownRec.quality)
                      ?.label,
                  ]
                    .filter(Boolean)
                    .map((tag) => (
                      <span
                        key={String(tag)}
                        className="rounded-[6px] bg-c-subtle px-1.5 py-0.5 font-medium text-c-text2"
                      >
                        {tag}
                      </span>
                    ))}
                  {typeof shownRec.cost === "number" && shownRec.cost > 0 && (
                    <span className="rounded-[6px] bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">
                      {locale === "en"
                        ? `${shownRec.cost} credits`
                        : `扣 ${shownRec.cost} 积分`}
                    </span>
                  )}
                </div>
                <div className="grid flex-1 grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <span className="text-[12px] font-medium text-c-text3">
                      {locale === "en" ? "Source" : "原图"}
                    </span>
                    <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[13px] border border-c-border bg-c-subtle2">
                      {shownRec.source ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={shownRec.source}
                            alt={locale === "en" ? "Source" : "原图"}
                            onClick={() =>
                              setViewing({
                                id: `rec-src-${shownRec.id}`,
                                url: shownRec.source!,
                                gradient: "",
                                prompt: "",
                                ratio: "1:1",
                                createdAt: "",
                              })
                            }
                            className="max-h-[460px] max-w-full cursor-zoom-in object-contain"
                          />
                          <button
                            type="button"
                            onClick={() => loadBaseImage(shownRec.source!, "source.png")}
                            className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-[rgba(22,24,29,.6)] px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-[rgba(22,24,29,.8)]"
                          >
                            <RefreshCw className="h-3 w-3" />
                            {t("gen.regenFromThis")}
                          </button>
                        </>
                      ) : (
                        <span className="text-[12px] text-c-text4">
                          {locale === "en" ? "No source" : "无原图"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-[12px] font-medium text-acc">
                      {locale === "en" ? "Result" : "成品"}
                    </span>
                    <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[13px] border border-c-border bg-c-subtle2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cdnUrl(shownRec.url)}
                        alt={locale === "en" ? "Result" : "成品"}
                        onClick={() =>
                          setViewing({
                            id: shownRec.id,
                            url: shownRec.url,
                            gradient: shownRec.gradient || "",
                            prompt: shownRec.prompt || "",
                            ratio: "1:1",
                            createdAt: "",
                          })
                        }
                        className="max-h-[460px] max-w-full cursor-zoom-in object-contain"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          loadImageAsBase({
                            id: shownRec.id,
                            url: shownRec.url,
                            gradient: shownRec.gradient || "",
                            prompt: shownRec.prompt || "",
                            ratio: "1:1",
                            createdAt: "",
                          })
                        }
                        className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-[rgba(22,24,29,.6)] px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-[rgba(22,24,29,.8)]"
                      >
                        <RefreshCw className="h-3 w-3" />
                        {t("gen.regenFromThis")}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadImage(shownRec.url, "生图")}
                        className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[rgba(22,24,29,.6)] text-white backdrop-blur transition-colors hover:bg-[rgba(22,24,29,.8)]"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
                {shownRec.prompt && (
                  <PromptPanel
                    className="mt-3"
                    prompt={shownRec.prompt}
                    title={locale === "en" ? "Prompt" : "提示词"}
                    reuseLabel={locale === "en" ? "Reuse prompt" : "以此提示词再创作"}
                    onReuse={() => {
                      setPrompt(shownRec.prompt || "");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  />
                )}
              </div>
            ) : (
              <>
            {images.length === 0 && !loading && (
              <>
                {/* 头部行 + demo(flex-1)+ 底部 note:与其它功能页(ToolWorkspace)
                    完全同构,保证中间示例图的垂直位置一致。 */}
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold text-c-text">
                    {locale === "en" ? "Result" : "生成结果"}
                  </h2>
                  <span className="text-[12.5px] text-c-text3">
                    {locale === "en" ? "Preview" : "示例预览"}
                  </span>
                </div>
                <ToolDemo {...getDemo("image")!} />
                <p className="mt-3 text-center text-[11px] text-c-text4">
                  {keepNote(keepDays, locale === "en")}
                </p>
              </>
            )}

            {loading && (
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: count }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "relative overflow-hidden rounded-2xl border border-border",
                      RATIO_ASPECT[ratio] ?? "aspect-square"
                    )}
                  >
                    {liveImages[i] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cdnUrl(liveImages[i].url)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <GenLoader />
                    )}
                  </div>
                ))}
              </div>
            )}

            {!loading && images.length > 0 && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[14px] font-semibold text-c-text">
                    本次生成 · {fmt(t("gen.resultCount"), { n: images.length })}
                  </p>
                  <div className="flex items-center gap-2">
                    <Segmented<"all" | "done">
                      value={resultFilter}
                      onChange={setResultFilter}
                      options={[
                        { value: "all", label: "全部" },
                        { value: "done", label: "已完成" },
                      ]}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        images
                          .filter((im) => im.id.startsWith("gen-"))
                          .forEach((im, i) => downloadImage(im.url, `${brandName}-${i + 1}`))
                      }
                      className="inline-flex items-center gap-1.5 rounded-[9px] border border-c-border2 px-3 py-1.5 text-[12.5px] font-medium text-c-text2 transition-colors hover:bg-c-subtle2"
                    >
                      <Download className="h-3.5 w-3.5" /> 下载全部
                    </button>
                    <Button variant="ghost" size="sm" onClick={generate}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      {t("gen.regenerate")}
                    </Button>
                  </div>
                </div>
                {baseNotice && (
                  <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    ✓ {t("gen.baseSet")}
                  </p>
                )}
                <div className="grid gap-3.5 sm:grid-cols-2" style={{ maxWidth: 760 }}>
                  {images
                    .filter((im) => resultFilter === "all" || im.id.startsWith("gen-"))
                    .map((image, i) => {
                      const isTpl = image.id.startsWith("tpl-");
                      const isPrev = image.id.startsWith("prev-");
                      const isRef = isTpl || isPrev;
                      const rlabel = image.ratio === "auto" ? "默认" : image.ratio;
                      return (
                        <div
                          key={image.id}
                          className="group relative cursor-pointer overflow-hidden rounded-[13px] border border-c-border"
                          onClick={() => setViewing(image)}
                          title={t("gen.viewLarge")}
                        >
                          <Media
                            src={cdnUrl(image.url)}
                            alt={image.prompt}
                            gradient={image.gradient}
                            ratio={RATIO_ASPECT[image.ratio] ?? "aspect-square"}
                          />
                          {/* 左上标签:参考图显来源,生成图显比例 */}
                          <span className="absolute left-2 top-2 rounded-full bg-[rgba(22,24,29,.5)] px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
                            {isTpl ? t("gen.labelTpl") : isPrev ? t("gen.labelPrev") : rlabel}
                          </span>
                          {/* 删除:右上角小药丸(hover 显),放 overlay 外避免与底部药丸挤 */}
                          {!isRef && (
                            <button
                              type="button"
                              title={locale === "en" ? "Delete" : "删除"}
                              aria-label={locale === "en" ? "Delete" : "删除"}
                              onClick={(e) => {
                                e.stopPropagation();
                                setImages((prev) => prev.filter((x) => x.id !== image.id));
                              }}
                              className="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-full bg-[rgba(22,24,29,.6)] text-white opacity-0 backdrop-blur transition-all hover:bg-[rgba(22,24,29,.8)] group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {/* 底部操作(hover 渐变浮出层):左「以此图再生成」/ 右「下载」 */}
                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/55 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                loadImageAsBase(image);
                              }}
                              className="inline-flex items-center gap-1 rounded-full bg-[rgba(22,24,29,.6)] px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-[rgba(22,24,29,.8)]"
                            >
                              <RefreshCw className="h-3 w-3" />
                              {t("gen.regenFromThis")}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadImage(image.url, `${brandName}-${i + 1}`);
                              }}
                              className="flex items-center gap-1.5 rounded-[8px] bg-white/90 px-3 py-1.5 text-[12px] font-medium text-slate-900 hover:bg-white"
                            >
                              <Download className="h-3.5 w-3.5" />
                              {t("gen.export")}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
              </>
            )}
          </div>

          {/* 第 3 列:本工具记录(可折叠,仅 xl 宽屏) */}
          {historyOpen ? (
            <aside className="hidden rounded-2xl border border-c-border bg-c-card p-4 shadow-card xl:flex xl:h-full xl:flex-col xl:overflow-hidden">
              <div className="mb-3 flex min-h-[28px] flex-none items-center gap-1.5">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-c-text">
                  <Clock className="h-4 w-4 text-c-text3" />
                  {locale === "en" ? "Recent" : "本工具记录"}
                </span>
                {recSel.size > 0 && (
                  <button
                    type="button"
                    onClick={downloadRecSelected}
                    disabled={recZipping}
                    className="ml-auto inline-flex items-center gap-1 rounded-[8px] bg-acc px-2.5 py-1 text-[11.5px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
                  >
                    {recZipping ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    {locale === "en" ? "Download" : "下载"} {recSel.size}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  aria-label="收起"
                  className={cn(
                    "text-c-text4 transition-colors hover:text-c-text",
                    recSel.size === 0 && "ml-auto"
                  )}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
                {records === null && user ? (
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="nv-skeleton aspect-square rounded-lg" />
                    ))}
                  </div>
                ) : records && records.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {records
                      .slice(recPage * RECORDS_PER_PAGE, (recPage + 1) * RECORDS_PER_PAGE)
                      .map((r) => {
                      const sel = recSel.has(r.id);
                      return (
                      <div
                        key={r.id}
                        onClick={() => setShownRec(r)}
                        title={locale === "en" ? "View source / result" : "点击查看原图 / 成品"}
                        className={cn(
                          "group relative cursor-pointer overflow-hidden rounded-lg border-2 transition-all",
                          shownRec?.id === r.id
                            ? "border-acc"
                            : sel
                              ? "border-acc/40"
                              : "border-c-border hover:border-c-border2"
                        )}
                      >
                        <Media
                          src={cdnUrl(r.url)}
                          alt={r.prompt || ""}
                          gradient={r.gradient}
                          thumbWidth={240}
                          ratio="aspect-square"
                          className="rounded-none border-0 transition-transform group-hover:scale-105"
                        />
                        {/* 左上选择框:点它才选中(用于批量打包下载) */}
                        <span
                          role="checkbox"
                          aria-checked={sel}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRecSel(r.id);
                          }}
                          className={cn(
                            "absolute left-1 top-1 grid h-5 w-5 cursor-pointer place-items-center rounded-[6px] border-2 transition-colors",
                            sel
                              ? "border-acc bg-acc text-white"
                              : "border-white bg-black/25 text-transparent hover:bg-black/40"
                          )}
                        >
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="px-2 py-10 text-center text-xs text-c-text3">
                    {locale === "en" ? "No records yet" : "还没有记录"}
                  </p>
                )}
              </div>
              <RecordPager
                page={recPage}
                total={Math.ceil((records?.length ?? 0) / RECORDS_PER_PAGE)}
                onPage={setRecPage}
              />
              <Link
                href="/works?cat=main"
                className="mt-3 flex-none text-center text-[12px] font-medium text-acc hover:underline"
              >
                {locale === "en" ? "View all in Works →" : "在作品库查看全部 →"}
              </Link>
            </aside>
          ) : (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-label="展开记录"
              className="hidden xl:flex xl:h-full xl:flex-col xl:items-center xl:gap-3 xl:rounded-2xl xl:border xl:border-c-border xl:bg-c-card xl:py-4 xl:text-c-text4 xl:shadow-card xl:transition-colors xl:hover:text-c-text"
            >
              <ChevronLeft className="h-4 w-4" />
              <Clock className="h-4 w-4 text-c-text3" />
              <span className="text-[12px] text-c-text3 [writing-mode:vertical-rl]">
                本工具记录
              </span>
            </button>
          )}
        </div>

      </div>

      <PromptAssistPopup
        open={assistOpen}
        onClose={() => setAssistOpen(false)}
        anchorRef={assistBtnRef}
        tool="generate"
        category={category}
        currentPrompt={prompt}
        imageFile={files[0] ?? null}
        imageThumb={filePreviews[0] ?? ""}
        run={assistRun}
        onUse={(txt) => setPrompt(txt)}
      />

      {viewing && (
        <ImageLightbox
          src={cdnUrl(viewing.url)}
          alt={viewing.prompt}
          onClose={() => setViewing(null)}
          downloadName={`${brandName}-生图`}
        />
      )}
    </div>
  );
}
