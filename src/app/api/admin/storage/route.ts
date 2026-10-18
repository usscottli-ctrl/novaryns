import { NextResponse } from "next/server";
import {
  dbEnabled,
  purgeOldArtworks,
  storageUsage,
  TRASH_RETENTION_DAYS,
} from "@/lib/db";
import { deleteImageByUrl, storageDriver } from "@/lib/storage";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// 存储治理:用量查看(GET)+ 保留期清理(POST)。
//
// 保留期一直只写在文案里(「保留 180 天」),**没有任何清理任务** —— 存储只增不减。
// 云端租户的图还落在阿里云 ECS 磁盘上(按流量计费带宽 + 云盘),不清会先撑爆磁盘。
//
// 清理由 cron 调用(Bearer = INTERNAL_API_SECRET),也可在后台手动触发一次。
// ---------------------------------------------------------------------------

const KEEP_DAYS = Number(process.env.ARTWORK_KEEP_DAYS || 180);
// 回收站天数从 db.ts 取,和回收站列表的懒清理共用同一个值(别在这里另起一份)。
const TRASH_DAYS = TRASH_RETENTION_DAYS;

function cronAuthed(req: Request): boolean {
  const secret = (process.env.INTERNAL_API_SECRET || "").trim();
  if (!secret) return false;
  const h = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return h.trim() === secret;
}

export async function GET(req: Request) {
  if (!dbEnabled)
    return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  if (!(await requireAdmin(req)))
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  const usage = await storageUsage();
  return NextResponse.json({
    ...usage,
    driver: storageDriver,
    keepDays: KEEP_DAYS,
    trashDays: TRASH_DAYS,
  });
}

export async function POST(req: Request) {
  if (!dbEnabled)
    return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  // cron 用共享密钥;后台手动触发用管理员身份。
  if (!cronAuthed(req) && !(await requireAdmin(req)))
    return NextResponse.json({ error: "未授权" }, { status: 401 });

  // 分批删,最多跑 20 批(1 万条),避免单次请求太久;剩下的下次 cron 继续。
  let rows = 0;
  let objects = 0;
  for (let i = 0; i < 20; i++) {
    const r = await purgeOldArtworks(KEEP_DAYS, TRASH_DAYS, deleteImageByUrl);
    rows += r.rows;
    objects += r.objects;
    if (r.rows === 0) break;
  }
  return NextResponse.json({ ok: true, purgedRows: rows, deletedObjects: objects });
}
