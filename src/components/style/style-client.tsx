"use client";

import * as React from "react";
import { Palette } from "lucide-react";
import { ToolWorkspace, ToolChips } from "@/components/tools/tool-workspace";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";

const ACCENT = "#2E7CF6"; // 风格转换(蓝)

// 目标风格 chip → 发给后端的英文风格指令(style)+ 落库中文名(styleLabel)。
const STYLE_MAP: Record<string, { prompt: string; label: string }> = {
  写实: {
    prompt:
      "photorealistic style, true-to-life lighting, fine realistic detail and texture",
    label: "写实",
  },
  插画: {
    prompt:
      "flat illustration / digital painting style, clean shapes, vibrant colours",
    label: "插画",
  },
  "3D": {
    prompt:
      "cute 3D cartoon render, Pixar / Blender style, soft global illumination",
    label: "3D",
  },
  赛博: {
    prompt:
      "cyberpunk style, neon glow, futuristic, high contrast, rain-soaked",
    label: "赛博",
  },
};

// 保留构图 chip → 附加到风格指令的构图保真要求。
const COMPOSITION_MAP: Record<string, string> = {
  强: " Strictly preserve the original composition, layout and pose.",
  中: " Mostly keep the original composition with minor freedom.",
  弱: " Loosely keep the subject, composition may change.",
};

export function StyleClient() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [target, setTarget] = React.useState("写实");
  const [keep, setKeep] = React.useState("强");

  const controls = (
    <>
      <ToolChips
        label={L("目标风格", "Target style")}
        options={[
          { value: "写实", label: L("写实", "Realistic") },
          { value: "插画", label: L("插画", "Illustration") },
          { value: "3D", label: "3D" },
          { value: "赛博", label: L("赛博", "Cyberpunk") },
        ]}
        value={target}
        onChange={setTarget}
        accent={ACCENT}
      />
      <ToolChips
        label={L("保留构图", "Keep composition")}
        options={[
          { value: "强", label: L("强", "Strong") },
          { value: "中", label: L("中", "Medium") },
          { value: "弱", label: L("弱", "Loose") },
        ]}
        value={keep}
        onChange={setKeep}
        accent={ACCENT}
      />
    </>
  );

  return (
    <ToolWorkspace
      name={L("风格转换", "Style Transfer")}
      desc={L("一键切换画面整体风格", "Switch the overall visual style in one click")}
      Icon={Palette}
      tint="var(--c-tint-b)"
      accent={ACCENT}
      category="style"
      regenLabel={L("以此图再换风格", "Restyle from this image")}
      cost={6}
      action={L("转换风格", "Apply style")}
      controls={controls}
      onProcess={async (file) => {
        const sty = STYLE_MAP[target] ?? STYLE_MAP["写实"];
        const fd = new FormData();
        fd.append("image", file);
        // 目标风格 chip → 后端要求的 style 英文指令 + 落库中文名;
        // 保留构图 chip → 拼到 style 指令里(后端无独立字段)。
        fd.append("style", sty.prompt + (COMPOSITION_MAP[keep] ?? ""));
        fd.append("styleLabel", sty.label);
        if (user) fd.append("email", user.email);
        const res = await fetch("/api/style", {
          method: "POST",
          headers: await authHeader(),
          body: fd,
        });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error ?? "转换失败");
        return { url: data.url, user: data.user, creditsUsed: data.creditsUsed };
      }}
    />
  );
}
