"use client";

import * as React from "react";
import { Wind } from "lucide-react";
import { ToolWorkspace, ToolChips } from "@/components/tools/tool-workspace";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";

const ACCENT = "#7C3AED"; // 服装去皱(紫)

export function DewrinkleClient() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [strength, setStrength] = React.useState("轻");
  const [keepTexture, setKeepTexture] = React.useState("是");

  const controls = (
    <>
      <ToolChips
        label={L("去皱强度", "De-wrinkle strength")}
        options={[
          { value: "轻", label: L("轻", "Light") },
          { value: "中", label: L("中", "Medium") },
          { value: "强", label: L("强", "Strong") },
        ]}
        value={strength}
        onChange={setStrength}
        accent={ACCENT}
      />
      <ToolChips
        label={L("保留纹理", "Keep texture")}
        options={[
          { value: "是", label: L("是", "Yes") },
          { value: "否", label: L("否", "No") },
        ]}
        value={keepTexture}
        onChange={setKeepTexture}
        accent={ACCENT}
      />
    </>
  );

  return (
    <ToolWorkspace
      name={L("服装去皱", "De-wrinkle")}
      desc={L("智能去除衣物褶皱与瑕疵", "Smartly remove garment wrinkles and flaws")}
      Icon={Wind}
      tint="var(--c-tint-v)"
      accent={ACCENT}
      category="dewrinkle"
      regenLabel={L("以此图再去皱", "De-wrinkle from this image")}
      cost={6}
      action={L("一键去皱", "De-wrinkle")}
      controls={controls}
      onProcess={async (file) => {
        const fd = new FormData();
        fd.append("image", file);
        // 比例固定走「自动」(后端 sizeForRatio 据此决定输出尺寸);
        // 去皱强度/保留纹理为展示偏好,后端无对应参数,不映射。
        fd.append("ratio", "自动");
        if (user) fd.append("email", user.email);
        const res = await fetch("/api/dewrinkle", {
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
