"use client";

import * as React from "react";
import { Shirt } from "lucide-react";
import { ToolWorkspace, ToolChips } from "@/components/tools/tool-workspace";
import { TOOL_COST } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";

const ACCENT = "#7C3AED"; // 服装提取(紫)

export function GarmentClient() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [detail, setDetail] = React.useState("标准");
  const [form, setForm] = React.useState("平铺");

  const controls = (
    <>
      <ToolChips
        label={L("保留细节", "Detail")}
        options={[
          { value: "标准", label: L("标准", "Standard") },
          { value: "精细", label: L("精细", "Fine") },
        ]}
        value={detail}
        onChange={setDetail}
        accent={ACCENT}
      />
      <ToolChips
        label={L("输出形态", "Output style")}
        options={[
          { value: "平铺", label: L("平铺", "Flat lay") },
          { value: "挂拍", label: L("挂拍", "Hanging") },
        ]}
        value={form}
        onChange={setForm}
        accent={ACCENT}
      />
    </>
  );

  return (
    <ToolWorkspace
      name={L("服装提取", "Garment Photo")}
      desc={L("从模特图中提取平铺服装图", "Extract a flat-lay garment image from model photos")}
      Icon={Shirt}
      tint="var(--c-tint-v)"
      accent={ACCENT}
      category="garment"
      regenLabel={L("以此图再提取", "Extract from this image")}
      cost={TOOL_COST.garment}
      action={L("提取平铺图", "Extract flat lay")}
      controls={controls}
      onProcess={async (file) => {
        const fd = new FormData();
        fd.append("image", file);
        // 后端默认白底(bg 非 black/transparent 即白底),保持原契约。
        fd.append("bg", "white");
        if (user) fd.append("email", user.email);
        const res = await fetch("/api/garment", {
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
