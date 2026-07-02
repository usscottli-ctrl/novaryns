import { Suspense } from "react";
import { CheckoutClient } from "@/components/checkout/checkout-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `结账 — ${BRAND}` };

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="container py-20 text-sm text-muted-foreground">
          加载结账页…
        </div>
      }
    >
      <CheckoutClient />
    </Suspense>
  );
}
