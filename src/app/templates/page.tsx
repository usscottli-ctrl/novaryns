import { TemplatesClient } from "@/components/templates/templates-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `Prompt 模板库 — ${BRAND}` };

export default function TemplatesPage() {
  return <TemplatesClient />;
}
