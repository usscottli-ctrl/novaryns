"use client";

import * as React from "react";
import { Box } from "lucide-react";
import { ToolWorkspace, ToolChips } from "@/components/tools/tool-workspace";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";

const ACCENT = "#7C3AED"; // 3D 服装图(紫)

export function Garment3dClient() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [view, setView] = React.useState("正面");
  const [material, setMaterial] = React.useState("真实");

  const controls = (
    <>
      <ToolChips
        label={L("视角", "View")}
        options={[
          { value: "正面", label: L("正面", "Front") },
          { value: "45°", label: "45°" },
          { value: "360°", label: "360°" },
        ]}
        value={view}
        onChange={setView}
        accent={ACCENT}
      />
      <ToolChips
        label={L("材质", "Material")}
        options={[
          { value: "真实", label: L("真实", "Realistic") },
          { value: "光泽", label: L("光泽", "Glossy") },
          { value: "哑光", label: L("哑光", "Matte") },
        ]}
        value={material}
        onChange={setMaterial}
        accent={ACCENT}
      />
    </>
  );

  return (
    <ToolWorkspace
      name={L("3D 服装图", "3D Garment")}
      desc={L("生成立体可旋转的服装展示图", "Generate a rotatable 3D garment showcase")}
      Icon={Box}
      tint="var(--c-tint-v)"
      accent={ACCENT}
      category="dress3d"
      regenLabel={L("以此图再生成 3D", "Regenerate 3D from this image")}
      cost={16}
      action={L("生成 3D 图", "Generate 3D")}
      controls={controls}
      onProcess={async (file) => {
        const fd = new FormData();
        fd.append("image", file);
        // 后端必需的固定参数:品类(garment 类型提示)与比例。chip 是展示偏好,
        // 通过 prompt 文本影响输出,不改后端契约。
        fd.append("category", "通用");
        fd.append("ratio", "自动");
        const viewHint =
          view === "45°"
            ? "show the garment from a 45-degree angle"
            : view === "360°"
            ? "render as a rotatable 360-degree turntable product view"
            : "front-facing view";
        const materialHint =
          material === "光泽"
            ? "glossy fabric finish"
            : material === "哑光"
            ? "matte fabric finish"
            : "true-to-life realistic fabric finish";
        fd.append("prompt", `${viewHint}; ${materialHint}`);
        if (user) fd.append("email", user.email);
        const res = await fetch("/api/garment3d", {
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
