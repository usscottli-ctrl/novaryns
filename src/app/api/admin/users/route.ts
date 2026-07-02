import { NextResponse } from "next/server";
import {
  dbEnabled,
  listAllUsers,
  adminStats,
  listLedger,
  setUserRole,
  adjustUserCredits,
  deleteUser,
  setUserBanned,
  setUserNote,
  banIp,
  unbanIp,
  listBannedIps,
  getUser,
  listArtworks,
  listUserLedger,
} from "@/lib/db";
import { isAdminToken, bearer } from "@/lib/supabase-admin";
import { proEnabled } from "@/lib/edition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function snapshot() {
  const [stats, users, ledger, bannedIps] = await Promise.all([
    adminStats(),
    listAllUsers(),
    listLedger(50),
    listBannedIps(),
  ]);
  return { stats, users, ledger, bannedIps };
}

async function guard(req: Request): Promise<NextResponse | null> {
  if (!dbEnabled) {
    return NextResponse.json(
      { error: "未配置数据库，管理不可用" },
      { status: 503 }
    );
  }
  if (!(await isAdminToken(bearer(req)))) {
    return NextResponse.json({ error: "需要管理员身份" }, { status: 403 });
  }
  if (!(await proEnabled())) {
    return NextResponse.json({ error: "该功能为 Pro 版功能" }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  // ?email= -> per-member detail (artworks + credit ledger)
  const email = new URL(req.url).searchParams.get("email");
  if (email) {
    const e = email.trim().toLowerCase();
    const [user, artworks, ledger] = await Promise.all([
      getUser(e),
      listArtworks(e),
      listUserLedger(e, 100),
    ]);
    return NextResponse.json({ detail: { email: e, user, artworks, ledger } });
  }
  return NextResponse.json(await snapshot());
}

export async function POST(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;

  let body: {
    action?: string;
    email?: string;
    role?: string;
    delta?: number;
    months?: number;
    banned?: boolean;
    ip?: string;
    reason?: string;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const action = body.action ?? "";
  const ipActions = new Set(["ban-ip", "unban-ip"]);

  try {
    if (ipActions.has(action)) {
      const ip = (body.ip ?? "").trim();
      if (!ip) {
        return NextResponse.json({ error: "缺少 ip" }, { status: 400 });
      }
      if (action === "ban-ip") {
        await banIp(ip, (body.reason ?? "").trim());
      } else {
        await unbanIp(ip);
      }
      return NextResponse.json(await snapshot());
    }

    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "缺少 email" }, { status: 400 });
    }

    if (action === "role") {
      await setUserRole(email, body.role === "admin" ? "admin" : "user");
    } else if (action === "adjust") {
      const d = Math.trunc(Number(body.delta) || 0);
      if (!d) {
        return NextResponse.json(
          { error: "调整值无效" },
          { status: 400 }
        );
      }
      // months: 赠送积分有效期(月);0/负=永久;缺省=2年兜底。仅加分时生效。
      const months =
        body.months === undefined || body.months === null
          ? undefined
          : Math.trunc(Number(body.months));
      await adjustUserCredits(email, d, "管理员调整积分", { months });
    } else if (action === "ban") {
      await setUserBanned(email, body.banned === true);
    } else if (action === "note") {
      await setUserNote(email, body.note ?? "");
    } else if (action === "delete") {
      await deleteUser(email);
    } else {
      return NextResponse.json(
        { error: "未知操作" },
        { status: 400 }
      );
    }
    return NextResponse.json(await snapshot());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "操作失败" },
      { status: 500 }
    );
  }
}
