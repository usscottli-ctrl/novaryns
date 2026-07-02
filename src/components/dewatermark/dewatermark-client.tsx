"use client";

import * as React from "react";
import { Eraser } from "lucide-react";
import { ToolWorkspace, ToolChips } from "@/components/tools/tool-workspace";
import { TOOL_COST } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";

const ACCENT = "#2E7CF6"; // 去水印(图像处理 · 蓝)

export function DewatermarkClient() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [wmType, setWmType] = React.useState("通用");

  // 水印类型→给后端追加一句提示(通用则不加)。
  const hint = (t: string) =>
    t === "文字"
      ? "The watermark is mainly text / station names; focus on removing text watermarks."
      : t === "Logo"
        ? "The watermark is mainly a logo / icon / stamp; focus on removing it."
        : "";

  const controls = (
    <ToolChips
      label={L("水印类型", "Watermark type")}
      options={[
        { value: "通用", label: L("通用", "Auto") },
        { value: "文字", label: L("文字", "Text") },
        { value: "Logo", label: L("Logo", "Logo") },
      ]}
      value={wmType}
      onChange={setWmType}
      accent={ACCENT}
    />
  );

  return (
    <ToolWorkspace
      name={L("去水印", "Remove Watermark")}
      desc={L(
        "智能擦除水印 / logo / 文字并自然补全底图",
        "Erase watermarks, logos and text, then restore the image"
      )}
      Icon={Eraser}
      tint="var(--c-tint-b)"
      accent={ACCENT}
      category="dewatermark"
      regenLabel={L("以此图再去水印", "Remove watermark from this image")}
      cost={TOOL_COST.dewatermark}
      action={L("一键去水印", "Remove Watermark")}
      controls={controls}
      onProcess={async (file) => {
        const fd = new FormData();
        fd.append("image", file);
        // 比例固定走「自动」(后端 sizeForRatio 据此决定输出尺寸)。
        fd.append("ratio", "自动");
        const h = hint(wmType);
        if (h) fd.append("prompt", h);
        if (user) fd.append("email", user.email);
        const res = await fetch("/api/dewatermark", {
          method: "POST",
          headers: await authHeader(),
          body: fd,
        });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error ?? "生成失败");
        return { url: data.url, user: data.user, creditsUsed: data.creditsUsed };
      }}
    />
  );
}
