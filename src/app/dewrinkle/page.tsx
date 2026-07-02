import { DewrinkleClient } from "@/components/dewrinkle/dewrinkle-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `服装去皱 — ${BRAND}` };

export default function DewrinklePage() {
  return <DewrinkleClient />;
}
