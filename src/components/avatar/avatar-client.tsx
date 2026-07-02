"use client";

import * as React from "react";
import { Smile } from "lucide-react";
import { ToolWorkspace, ToolChips } from "@/components/tools/tool-workspace";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";

const ACCENT = "#2E7CF6"; // 抠头像(蓝)

export function AvatarClient() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  const [bgColor, setBgColor] = React.useState("白");
  const [size, setSize] = React.useState("一寸");

  const controls = (
    <>
      <ToolChips
        label={L("证件底色", "Background color")}
        options={[
          { value: "白", label: L("白", "White") },
          { value: "蓝", label: L("蓝", "Blue") },
          { value: "红", label: L("红", "Red") },
        ]}
        value={bgColor}
        onChange={setBgColor}
        accent={ACCENT}
      />
      <ToolChips
        label={L("尺寸规格", "Size")}
        options={[
          { value: "一寸", label: L("一寸", "1-inch") },
          { value: "二寸", label: L("二寸", "2-inch") },
          { value: "自定义", label: L("自定义", "Custom") },
        ]}
        value={size}
        onChange={setSize}
        accent={ACCENT}
      />
    </>
  );

  return (
    <ToolWorkspace
      name={L("抠头像", "AI Avatar")}
      desc={L("人像、证件照精准抠取,自动补光", "Precise portrait & ID-photo cutout with auto fill light")}
      Icon={Smile}
      tint="var(--c-tint-b)"
      accent={ACCENT}
      category="avatar"
      regenLabel={L("以此图再生成", "Regenerate from this image")}
      cost={4}
      action={L("开始抠图", "Start cutout")}
      checker
      controls={controls}
      onProcess={async (file) => {
        const fd = new FormData();
        fd.append("image", file);
        // 证件底色「白」→ 后端白底;蓝/红 后端不支持纯证件底色,
        // 用透明底输出(展示偏好,功能优先,不破坏契约)。
        fd.append("bg", bgColor === "白" ? "white" : "transparent");
        if (user) fd.append("email", user.email);
        const res = await fetch("/api/avatar", {
          method: "POST",
          headers: await authHeader(),
          body: fd,
        });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error ?? "抠图失败");
        return { url: data.url, user: data.user, creditsUsed: data.creditsUsed };
      }}
    />
  );
}
