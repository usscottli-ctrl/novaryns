import { Suspense } from "react";
import { AdminClient } from "@/components/admin/admin-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `管理后台 — ${BRAND}` };

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="container py-20 text-sm text-muted-foreground">
          加载管理后台…
        </div>
      }
    >
      <AdminClient />
    </Suspense>
  );
}
