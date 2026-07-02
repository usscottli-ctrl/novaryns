import { Garment3dClient } from "@/components/garment3d/garment3d-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `3D 服装图 — ${BRAND}` };

export default function Garment3dPage() {
  return <Garment3dClient />;
}
