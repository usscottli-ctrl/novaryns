import { Suspense } from "react";
import { GenChatClient } from "@/components/genchat/genchat-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `对话生成 — ${BRAND}` };

export default function GenChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
          加载对话…
        </div>
      }
    >
      <GenChatClient />
    </Suspense>
  );
}
