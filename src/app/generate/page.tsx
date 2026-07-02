import { Suspense } from "react";
import { GenerateClient } from "@/components/generate/generate-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `视觉生产工作台 — ${BRAND}` };

export default function GeneratePage() {
  return (
    <Suspense
      fallback={
        <div className="container py-20 text-sm text-muted-foreground">
          加载工作台…
        </div>
      }
    >
      <GenerateClient />
    </Suspense>
  );
}
