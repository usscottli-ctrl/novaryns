"use client";

import * as React from "react";
import { Stamp, Wand2, Sparkles } from "lucide-react";
import { PromptAssistPopup } from "@/components/tools/prompt-assist-popup";
import { ToolWorkspace, ToolChips } from "@/components/tools/tool-workspace";
import { SelectMenu } from "@/components/ui/select-menu";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { resolutionCost } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const ACCENT = "#C2882E"; // 印花提取(琥珀)

const MODES = [
  {
    value: "basic",
    zh: "基础模式",
    en: "Basic",
    descZh: "遮挡少的印花类商品。适用于挂钟、T 恤等简单场景印花提取",
    descEn: "Products with little occlusion — clocks, T-shirts and simple scenes.",
  },
  {
    value: "advanced",
    zh: "高阶模式",
    en: "Advanced",
    descZh:
      "大幅褶皱、遮挡严重、低清晰度的印花商品。适用于抱枕、桌布、毛毯、浴帘等复杂场景",
    descEn:
      "Heavy wrinkles, severe occlusion or low clarity — cushions, tablecloths, blankets, curtains.",
  },
];

const CATEGORIES = [
  "通用",
  "T恤/服装",
  "抱枕",
  "桌布",
  "毛毯",
  "浴帘",
  "挂毯",
  "帆布包",
  "地毯",
];
const RATIOS = ["自动", "1:1", "3:4", "4:3", "16:9", "9:16"];

export function ExtractClient() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [mode, setMode] = React.useState("basic");
  const [category, setCategory] = React.useState("通用");
  const [ratio, setRatio] = React.useState("自动");
  const [complete, setComplete] = React.useState("0");
  const [resolution, setResolution] = React.useState("1K");
  const [output, setOutput] = React.useState("透明底");
  // 补充描述(选填,拼进提取提示词)+ AI帮写/智能优化(必传图)
  const [extra, setExtra] = React.useState("");
  // ToolWorkspace 持有输入图,经 onFileChange 镜像到这里给帮写弹窗看图用。
  const [assistFile, setAssistFile] = React.useState<File | null>(null);
  const [assistThumb, setAssistThumb] = React.useState("");
  const [assistErr, setAssistErr] = React.useState<string | null>(null);
  const assistBtnRef = React.useRef<HTMLButtonElement>(null);
  const [assistOpen, setAssistOpen] = React.useState(false);
  const [assistRun, setAssistRun] = React.useState<{ mode: "write" | "optimize"; nonce: number } | null>(null);
  function openAssist(mode: "write" | "optimize") {
    if (!assistFile) {
      setAssistErr(L("请先上传图片", "Upload an image first"));
      return;
    }
    setAssistErr(null);
    setAssistOpen(true);
    setAssistRun({ mode, nonce: Date.now() });
  }

  const cost = resolutionCost(resolution);

  const controls = (
    <>
      {/* 模式(基础/高阶,带说明) */}
      <div>
        <p className="mb-2 text-[12.5px] font-medium text-c-text2">
          <span className="text-c-danger">* </span>
          {L("模式", "Mode")}
        </p>
        <div className="space-y-2">
          {MODES.map((m) => {
            const on = mode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={cn(
                  "w-full rounded-[10px] border p-3 text-left transition-colors",
                  on
                    ? "border-[1.5px] border-acc bg-acc-tint"
                    : "border-c-border2 hover:bg-c-subtle2"
                )}
              >
                <p className="text-[13px] font-semibold text-c-text">
                  {L(m.zh, m.en)}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-c-text3">
                  {L(m.descZh, m.descEn)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 品类 */}
      <div>
        <p className="mb-2 text-[12.5px] font-medium text-c-text2">
          <span className="text-c-danger">* </span>
          {L("品类", "Category")}
        </p>
        <SelectMenu
          value={category}
          onChange={setCategory}
          className="w-full"
          options={CATEGORIES.map((c) => ({ value: c, label: c }))}
        />
      </div>

      {/* 比例 */}
      <div>
        <p className="mb-2 text-[12.5px] font-medium text-c-text2">
          {L("比例", "Ratio")}
        </p>
        <SelectMenu
          value={ratio}
          onChange={setRatio}
          className="w-full"
          options={RATIOS.map((r) => ({
            value: r,
            label: r === "自动" ? L("自动", "Auto") : r,
          }))}
        />
      </div>

      {/* 扩展补全 */}
      <ToolChips
        label={L("扩展补全", "Complete")}
        options={[
          { value: "0", label: L("不补全", "Off") },
          { value: "1", label: L("补全", "On") },
        ]}
        value={complete}
        onChange={setComplete}
        accent={ACCENT}
      />

      {/* 分辨率(计费:1K=6 / 2K=8 / 4K=12) */}
      <ToolChips
        label={L("分辨率", "Resolution")}
        options={[
          { value: "1K", label: "1K" },
          { value: "2K", label: "2K" },
          { value: "4K", label: "4K" },
        ]}
        value={resolution}
        onChange={setResolution}
        accent={ACCENT}
      />

      {/* 输出底色 */}
      <ToolChips
        label={L("输出", "Output")}
        options={[
          { value: "透明底", label: L("透明底", "Transparent") },
          { value: "白底", label: L("白底", "White") },
        ]}
        value={output}
        onChange={setOutput}
        accent={ACCENT}
      />
      {/* 补充描述(选填)+ AI帮写/智能优化 */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[12.5px] font-medium text-c-text2">
            {L("补充描述", "Extra prompt")}{" "}
            <span className="text-[11px] font-normal text-c-text4">{L("(选填)", "(optional)")}</span>
          </p>
          <div className="flex items-center gap-2">
            {extra.trim() && (
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
              className="inline-flex items-center gap-1 text-[12px] font-medium text-acc hover:underline"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {L("AI帮写", "AI write")}
            </button>
          </div>
        </div>
        <textarea
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          rows={2}
          placeholder={L("例如:只要中间的花卉图案,保留原配色", "e.g. only the floral motif, keep original colours")}
          className="w-full resize-none rounded-field border border-c-border bg-c-card px-3 py-2 text-[13px] leading-relaxed text-c-text focus:border-acc focus:outline-none"
        />
        {assistErr && <p className="mt-1 text-[12px] text-c-danger">{assistErr}</p>}
        <PromptAssistPopup
          open={assistOpen}
          onClose={() => setAssistOpen(false)}
          anchorRef={assistBtnRef}
          tool="extract"
          currentPrompt={extra}
          imageFile={assistFile}
          imageThumb={assistThumb}
          run={assistRun}
          onUse={(t) => setExtra(t)}
        />
      </div>
    </>
  );

  return (
    <ToolWorkspace
      name={L("印花提取", "Print Extract")}
      desc={L(
        "从服装图中提取印花 / 图案为独立素材",
        "Extract prints / patterns from garment images as standalone assets"
      )}
      Icon={Stamp}
      tint="var(--c-tint-a)"
      accent={ACCENT}
      category="print"
      regenLabel={L("以此图再提取印花", "Extract print from this image")}
      cost={cost}
      action={L("提取印花", "Extract print")}
      checker
      controls={controls}
      onFileChange={(f, url) => {
        setAssistFile(f);
        setAssistThumb(url);
      }}
      onProcess={async (file) => {
        const fd = new FormData();
        fd.append("image", file);
        if (extra.trim()) fd.append("prompt", extra.trim());
        fd.append("bg", output === "白底" ? "white" : "transparent");
        fd.append("mode", mode); // basic | advanced
        fd.append("complete", complete); // 0 | 1
        fd.append("category", category);
        fd.append("ratio", ratio);
        fd.append("resolution", resolution);
        if (user) fd.append("email", user.email);
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: await authHeader(),
          body: fd,
        });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error ?? "提取失败");
        return { url: data.url, user: data.user, creditsUsed: data.creditsUsed };
      }}
    />
  );
}
