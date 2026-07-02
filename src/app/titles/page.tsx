import { TitleGenClient } from "@/components/titles/title-gen-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `标题生成 — ${BRAND}` };

export default function TitlesPage() {
  return <TitleGenClient />;
}
