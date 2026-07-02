"use client";

import * as React from "react";
import { Scissors } from "lucide-react";
import { ToolWorkspace, ToolChips } from "@/components/tools/tool-workspace";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";

const ACCENT = "#2E7CF6"; // 图像处理(蓝)

export function CutoutClient() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [feather, setFeather] = React.useState("关");
  const [bg, setBg] = React.useState("透明");

  const controls = (
    <>
      <ToolChips
        label={L("边缘羽化", "Edge feather")}
        options={[
          { value: "关", label: L("关", "Off") },
          { value: "弱", label: L("弱", "Light") },
          { value: "强", label: L("强", "Strong") },
        ]}
        value={feather}
        onChange={setFeather}
        accent={ACCENT}
      />
      <ToolChips
        label={L("输出背景", "Output background")}
        options={[
          { value: "透明", label: L("透明", "Transparent") },
          { value: "白底", label: L("白底", "White") },
          { value: "纯色", label: L("纯色", "Solid") },
        ]}
        value={bg}
        onChange={setBg}
        accent={ACCENT}
      />
    </>
  );

  return (
    <ToolWorkspace
      name={L("AI 抠图", "AI Cutout")}
      desc={L("自动识别主体去背景,发丝级边缘精度", "Auto subject detection, hair-level edge precision")}
      Icon={Scissors}
      tint="var(--c-tint-b)"
      accent={ACCENT}
      category="cutout"
      regenLabel={L("以此图重新抠", "Re-cut from this image")}
      cost={4}
      action={L("开始抠图", "Start cutout")}
      checker
      controls={controls}
      onProcess={async (file) => {
        const fd = new FormData();
        fd.append("image", file);
        // 抠图后端只发丝级一档,统一发 quality=fine;归入「抠图」分类。
        // 边缘羽化 / 输出背景为前端展示偏好,后端无对应参数,固定参数照发以保功能。
        fd.append("quality", "fine");
        fd.append("title", file.name.replace(/\.[^.]+$/, "") || "抠图");
        fd.append("category", "cutout");
        if (user) fd.append("email", user.email);
        const res = await fetch("/api/cutout", {
          method: "POST",
          headers: await authHeader(),
          body: fd,
        });
        const data = await res.json();
        if (!res.ok || !data.ok || !data.url) {
          throw new Error(data.error ?? "抠图失败");
        }
        return { url: data.url, user: data.user, creditsUsed: data.creditsUsed };
      }}
    />
  );
}
