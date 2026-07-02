import { CanvasClient } from "@/components/canvas/canvas-client";
import { CanvasErrorBoundary } from "@/components/canvas/canvas-error-boundary";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `创作画布 — ${BRAND}` };

export default function CanvasPage() {
  return (
    <CanvasErrorBoundary>
      <CanvasClient />
    </CanvasErrorBoundary>
  );
}
