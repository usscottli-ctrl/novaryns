import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { proEnabled, isLicenseIssuer } from "@/lib/edition";
import {
  relayConfigured,
  listTokens,
  createToken,
  patchToken,
  deleteToken,
} from "@/lib/relay";

// 签发站后台:中转密钥管理(生成/列表/停用启用/续费/删除)。
// 三重门控:管理员身份 + Pro + 仅签发站(host=ai.starzeco.com,且配置了 relay env)。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(request: Request): Promise<NextResponse | null> {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }
  if (!(await proEnabled())) {
    return NextResponse.json({ error: "该功能为 Pro 版功能" }, { status: 403 });
  }
  if (!isLicenseIssuer(request)) {
    return NextResponse.json(
      { error: "本站不是签发站,中转密钥请到国内主站(ai.starzeco.com)后台管理。" },
      { status: 403 }
    );
  }
  if (!relayConfigured()) {
    return NextResponse.json(
      { error: "本站未配置中转服务(缺少 RELAY_MANAGE_URL / RELAY_ADMIN_SECRET)。" },
      { status: 503 }
    );
  }
  return null;
}

export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  try {
    return NextResponse.json({ tokens: await listTokens() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取失败" },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  let body: {
    label?: string;
    contact?: string;
    months?: number | null;
    kind?: "byok" | "managed";
    quota?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const months =
    body.months == null || Number(body.months) <= 0 ? null : Number(body.months);
  try {
    const token = await createToken({
      label: String(body.label ?? "").slice(0, 200),
      contact: String(body.contact ?? "").slice(0, 200),
      months,
      kind: body.kind === "managed" ? "managed" : "byok",
      quota:
        Number.isFinite(Number(body.quota)) && Number(body.quota) > 0
          ? Math.floor(Number(body.quota))
          : 0,
    });
    return NextResponse.json({ token });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成失败" },
      { status: 502 }
    );
  }
}

export async function PATCH(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  let body: {
    id?: string;
    status?: "active" | "disabled";
    addMonths?: number;
    addQuota?: number;
    kind?: "byok" | "managed";
    label?: string;
    contact?: string;
    expires_at?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!/^[0-9a-f]+$/.test(id)) {
    return NextResponse.json({ error: "缺少或非法 id" }, { status: 400 });
  }
  try {
    const token = await patchToken(id, {
      status: body.status,
      addMonths:
        Number.isFinite(Number(body.addMonths)) && Number(body.addMonths) > 0
          ? Number(body.addMonths)
          : undefined,
      addQuota:
        Number.isFinite(Number(body.addQuota)) && Number(body.addQuota) !== 0
          ? Math.floor(Number(body.addQuota))
          : undefined,
      kind: body.kind === "managed" || body.kind === "byok" ? body.kind : undefined,
      label: typeof body.label === "string" ? body.label.slice(0, 200) : undefined,
      contact:
        typeof body.contact === "string" ? body.contact.slice(0, 200) : undefined,
      expires_at: body.expires_at === null ? null : body.expires_at,
    });
    return NextResponse.json({ token });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新失败" },
      { status: 502 }
    );
  }
}

export async function DELETE(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!/^[0-9a-f]+$/.test(id)) {
    return NextResponse.json({ error: "缺少或非法 id" }, { status: 400 });
  }
  try {
    await deleteToken(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "删除失败" },
      { status: 502 }
    );
  }
}
