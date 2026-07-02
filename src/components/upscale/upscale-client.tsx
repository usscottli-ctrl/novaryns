"use client";

import * as React from "react";
import { Wand2 } from "lucide-react";
import { ToolWorkspace, ToolChips } from "@/components/tools/tool-workspace";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";

const ACCENT = "#2E7CF6"; // 图像处理(蓝)

export function UpscaleClient() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [scale, setScale] = React.useState("2x");
  const [direction, setDirection] = React.useState("通用");

  const controls = (
    <>
      <ToolChips
        label={L("放大倍数", "Scale")}
        options={[
          { value: "2x", label: "2x" },
          { value: "4x", label: "4x" },
        ]}
        value={scale}
        onChange={setScale}
        accent={ACCENT}
      />
      <ToolChips
        label={L("增强方向", "Enhance for")}
        options={[
          { value: "通用", label: L("通用", "General") },
          { value: "人像", label: L("人像", "Portrait") },
          { value: "商品", label: L("商品", "Product") },
        ]}
        value={direction}
        onChange={setDirection}
        accent={ACCENT}
      />
    </>
  );

  return (
    <ToolWorkspace
      name={L("AI 变清晰", "AI Upscale")}
      desc={L("模糊图、老照片一键高清修复放大", "Restore & upscale blurry images and old photos in one click")}
      Icon={Wand2}
      tint="var(--c-tint-b)"
      accent={ACCENT}
      category="upscale"
      regenLabel={L("以此图再放大", "Upscale from this image")}
      cost={6}
      action={L("高清修复", "Upscale")}
      controls={controls}
      onProcess={async (file) => {
        const fd = new FormData();
        fd.append("image", file);
        fd.append("scale", scale === "4x" ? "4" : "2");
        // 增强方向「人像」→ 开人脸修复;通用/商品 → 关。
        fd.append("faceEnhance", direction === "人像" ? "1" : "0");
        if (user) fd.append("email", user.email);
        const res = await fetch("/api/upscale", {
          method: "POST",
          headers: await authHeader(),
          body: fd,
        });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error ?? "放大失败");
        return { url: data.url, user: data.user, creditsUsed: data.creditsUsed };
      }}
    />
  );
}
