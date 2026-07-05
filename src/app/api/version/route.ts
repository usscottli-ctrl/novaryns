import { NextResponse } from "next/server";
import { buildVersion } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 公开:返回本实例的构建版本(时间戳)。自托管实例向官方站查这个来判断有没有新版。
// 允许跨域,方便任意实例读取。
export async function GET() {
  return NextResponse.json(
    { version: buildVersion() },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
}
