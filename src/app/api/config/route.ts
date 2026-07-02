import { NextResponse } from "next/server";
import { dbEnabled } from "@/lib/db";
import { storageEnabled } from "@/lib/storage";
import { authMode } from "@/lib/auth-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lets the client know which integrations are live so it can choose between
// server persistence and the localStorage mock.
export async function GET() {
  return NextResponse.json({
    db: dbEnabled,
    storage: storageEnabled,
    authMode,
    openai: (process.env.OPENAI_API_KEY ?? "").length > 0,
  });
}
