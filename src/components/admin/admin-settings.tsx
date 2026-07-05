"use client";

import { cdnUrl } from "@/lib/cdn";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  ShieldCheck,
  KeyRound,
  Cpu,
  Users,
  ImageIcon,
  Upload,
  Server,
  Database,
  Crown,
  RefreshCw,
  Ban,
  Trash2,
  Globe,
  Eye,
  X,
  Check,
  LayoutGrid,
  MessageSquare,
  Scissors,
  Shirt,
  ExternalLink,
  Palette,
  FileText,
  Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { browserSupabase } from "@/lib/supabase";
import { usePaymentConfig } from "@/lib/payment-context";
import { AdminTemplates } from "@/components/admin/admin-templates";
import { AdminTryon } from "@/components/admin/admin-tryon";
import { AdminArtworks } from "@/components/admin/admin-artworks";
import { Pager } from "@/components/admin/pager";
import { ImageLightbox } from "@/components/image-lightbox";
import { SelectMenu } from "@/components/ui/select-menu";
import { AdminPrompts } from "@/components/admin/admin-prompts";
import { DeployCenter } from "@/components/operator/deploy-center";
import { LicensesClient } from "@/components/operator/licenses-client";
import { CardkeysAdmin } from "@/components/operator/cardkeys-admin";

type AdminUser = {
  email: string;
  name: string;
  plan: string;
  role: string;
  creditsTotal: number;
  creditsUsed: number;
  artworks: number;
  banned: boolean;
  lastIp: string | null;
  recent7: number;
  note: string;
};
type Ledger = {
  id: string;
  email: string;
  delta: number;
  reason: string;
  kind?: string;
  expiresAt?: string | null;
  createdAt: string;
};
type BannedIp = {
  ip: string;
  reason: string;
  createdAt: string;
};
type UsersData = {
  stats: { users: number; artworks: number; remaining: number; used: number };
  users: AdminUser[];
  ledger: Ledger[];
  bannedIps: BannedIp[];
};
type MemberArtwork = {
  id: string;
  title: string;
  category: string;
  prompt: string;
  status: string;
  image: string;
  gradient: string;
  createdAt: string;
  style?: string | null;
  ratio?: string | null;
  resolution?: string | null;
  source?: string | null;
  batchId?: string | null;
  parentId?: string | null;
  groupId?: string | null;
};

// 点作品标题 → 进对应功能页(与前台 dashboard 的 workHref 同规则):
// 抠图→/cutout、融图→/fuse(带 ?view= 直接展示该图);其余→生图页(带 prompt+成品图,可复现/迭代)。
const artIsCutout = (a: MemberArtwork) =>
  a.category === "cutout" || a.prompt === "抠图 / 透明底";
const artIsFusion = (a: MemberArtwork) => a.category === "fusion";
function artworkToolHref(a: MemberArtwork): string {
  const view =
    a.image && /^https?:\/\//.test(a.image)
      ? `?view=${encodeURIComponent(a.image)}`
      : "";
  if (artIsCutout(a)) return `/cutout${view}`;
  if (artIsFusion(a)) return `/fuse${view}`;
  const q = new URLSearchParams();
  q.set("prompt", a.prompt);
  if (a.category) q.set("category", a.category);
  if (a.style) q.set("style", a.style);
  if (a.ratio) q.set("ratio", a.ratio);
  if (a.resolution) q.set("resolution", a.resolution);
  if (a.source && /^https?:\/\//.test(a.source)) q.set("src", a.source);
  if (a.status === "completed" && /^https?:\/\//.test(a.image)) {
    q.set("gen", a.image);
  }
  q.set("from", a.id);
  return `/generate?${q.toString()}`;
}

type MemberDetail = {
  email: string;
  user: {
    name: string;
    email: string;
    plan: string;
    creditsTotal: number;
    creditsUsed: number;
  } | null;
  artworks: MemberArtwork[];
  ledger: Ledger[];
};

type View = {
  model: string;
  cutoutModel: string;
  keyMasked: string;
  hasKey: boolean;
  source: "db" | "env" | "none";
  cutoutBackend?: "openai" | "replicate";
  cutoutReplicateReady?: boolean;
  cutoutReplicateModel?: string;
  cutoutReplicateTokenMasked?: string;
  signupBonus?: number;
  // 微信登录
  wechatAppid?: string;
  wechatToken?: string;
  wechatEmailDomain?: string;
  wechatSecretMasked?: string;
  wechatReady?: boolean;
  // 原生多用户开关
  multiUserEnabled?: boolean;
  // SMTP(忘记密码用)
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpFrom?: string;
  smtpConfigured?: boolean;
  // 支付
  payEnabled?: boolean;
  alipayAppid?: string;
  alipayPublicKey?: string;
  alipayPrivateKeyMasked?: string;
  alipayPrivateKeyReady?: boolean;
  alipayDerivedPublicKey?: string;
  wxpayMchid?: string;
  wxpayApiv3Masked?: string;
  wxpayApiv3Ready?: boolean;
  wxpayCertMasked?: string;
  wxpayCertReady?: boolean;
  wxpayCertSerial?: string;
  wxpayAppid?: string;
  // 品牌与白标(Pro)
  brandName?: string;
  brandLogo?: string;
  pageAbout?: string;
  pageContact?: string;
  pagePlans?: string;
};

type UserActionPayload = {
  action:
    | "role"
    | "adjust"
    | "ban"
    | "note"
    | "delete"
    | "ban-ip"
    | "unban-ip";
  email?: string;
  role?: string;
  delta?: number;
  months?: number; // 赠送积分有效期(月);0=永久。仅 adjust 加分时用
  banned?: boolean;
  ip?: string;
  reason?: string;
  note?: string;
};

const USERS_PER_PAGE = 5;
const LEDGER_PER_PAGE = 10;

const MODELS = [
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "gpt-image-2",
  "dall-e-3",
];

// 供应商充值入口(站长自助充值)。若图像走第三方中转,把 OPENAI_TOPUP_URL 换成中转商充值页。
const OPENAI_TOPUP_URL =
  "https://platform.openai.com/settings/organization/billing/overview";
const REPLICATE_TOPUP_URL = "https://replicate.com/account/billing";

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// In-browser RSA-OAEP(SHA-256) so the key never leaves as plaintext.
// RSA-OAEP(4096) 单块明文上限 ~446B;支付宝/微信「应用私钥·证书」是 1600+ 字符,
// 超限会抛 "data too large" → 分块加密(每块 ≤400B),用 "|" 拼;服务端按块解密拼回。
// 短 key(如 sk-/r8_)只有一块、无 "|",与旧逻辑完全一致,向后兼容。
async function encryptKey(plain: string, token: string): Promise<string> {
  const res = await fetch("/api/admin/pubkey", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "获取公钥失败");
  const pub = await crypto.subtle.importKey(
    "spki",
    pemToDer(data.pem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const all = new TextEncoder().encode(plain);
  const CHUNK = 400; // < 446B 安全边界(调用方已保证 plain 非空)
  const parts: string[] = [];
  for (let off = 0; off < all.length; off += CHUNK) {
    const slice = all.slice(off, off + CHUNK);
    const ct = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, slice);
    let bin = "";
    const bytes = new Uint8Array(ct);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    parts.push(btoa(bin));
  }
  return parts.join("|");
}

// 后台左侧分栏(方案 A)
// pro:true = 运营/变现/多用户向的分栏,仅 Pro(官方云/自托管激活)可见;
//            开源精简版(单个自托管者)隐藏。false = 自托管者配置自己实例要用的,始终开放。
const SECTIONS = [
  { id: "users", label: "用户与会员", icon: Users, pro: true },
  { id: "artworks", label: "作品库", icon: ImageIcon, pro: true },
  { id: "templates", label: "模板管理", icon: LayoutGrid, pro: false },
  { id: "tryon", label: "试穿素材库", icon: Shirt, pro: true },
  { id: "prompts", label: "提示词配置", icon: MessageSquare, pro: false },
  { id: "api", label: "接口与模型", icon: KeyRound, pro: false },
  { id: "auth", label: "登录与支付", icon: ShieldCheck, pro: true },
  { id: "brand", label: "品牌与站点", icon: Palette, pro: false },
  { id: "pages", label: "站点页面", icon: FileText, pro: false },
  { id: "ledger", label: "积分流水", icon: Database, pro: true },
  { id: "deploy", label: "部署与授权", icon: Server, pro: true },
  { id: "cardkeys", label: "兑换码", icon: Ticket, pro: true },
] as const;

// Pro 门控的板块 id 集合(左侧导航隐藏 + 内容区兜底不渲染)。
const PRO_SECTIONS = new Set<string>(
  SECTIONS.filter((s) => s.pro).map((s) => s.id)
);

// 配置块状态徽标:已生效(绿)/ 未生效(琥珀)。登录与支付各卡片头部统一用它。
function ReadyBadge({
  ready,
  className = "",
}: {
  ready: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        ready
          ? "bg-emerald-500/10 text-emerald-600"
          : "bg-amber-500/10 text-amber-600"
      } ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          ready ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      {ready ? "已生效" : "未生效"}
    </span>
  );
}

// Self-gating: renders only when the signed-in user is the configured admin
// (the API returns 403 otherwise). Drop it anywhere inside an authed page.
export function AdminSettings({ localAdmin = false }: { localAdmin?: boolean }) {
  // 白标门控:pro=true(官方云/自托管激活)照常显示全部分栏;开源精简版只留自托管者
  // 配置自己实例要用的分栏(接口与模型/提示词/模板),隐藏运营/变现/多用户向的分栏。
  const { pro } = usePaymentConfig();
  const [token, setToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [model, setModel] = useState("");
  const [cutoutModel, setCutoutModel] = useState("");
  const [cutoutBackend, setCutoutBackend] = useState<"openai" | "replicate">(
    "replicate"
  );
  const [replicateModel, setReplicateModel] = useState("");
  const [replicateTokenInput, setReplicateTokenInput] = useState("");
  const [bonus, setBonus] = useState(""); // 新用户注册赠送积分
  // ── 登录与支付板块 ──
  // 微信登录(明文字段 + AppSecret 加密输入)
  const [wechatAppid, setWechatAppid] = useState("");
  const [wechatToken, setWechatToken] = useState("");
  const [wechatEmailDomain, setWechatEmailDomain] = useState("");
  const [wechatSecretInput, setWechatSecretInput] = useState("");
  // 收款开关
  const [payEnabled, setPayEnabled] = useState(false);
  const [multiUserOn, setMultiUserOn] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  // 支付宝商户
  const [alipayAppid, setAlipayAppid] = useState("");
  const [alipayPublicKey, setAlipayPublicKey] = useState("");
  const [alipayPrivateKeyInput, setAlipayPrivateKeyInput] = useState("");
  // 微信支付商户
  const [wxpayMchid, setWxpayMchid] = useState("");
  const [wxpayAppid, setWxpayAppid] = useState("");
  const [wxpayCertSerial, setWxpayCertSerial] = useState("");
  const [wxpayApiv3Input, setWxpayApiv3Input] = useState("");
  const [wxpayCertInput, setWxpayCertInput] = useState("");
  // ── 品牌与白标(Pro)──
  const [brandName, setBrandName] = useState("");
  const [brandLogo, setBrandLogo] = useState("");
  // 站点页面(关于/联系/定价)自定义内容
  const [pageAbout, setPageAbout] = useState("");
  const [pageContact, setPageContact] = useState("");
  const [pagePlans, setPagePlans] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usersData, setUsersData] = useState<UsersData | null>(null);
  const [ipInput, setIpInput] = useState("");
  const [ipReason, setIpReason] = useState("");
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [detailRow, setDetailRow] = useState<AdminUser | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState(""); // 详情抽屉里的备注草稿
  // 点作品图 → 大图查看器(复用生图页 ImageLightbox)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
    null
  );
  const [userPage, setUserPage] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(0);
  // 左侧分栏:当前板块(方案 A,大厂式后台)
  const [section, setSection] = useState<
    | "users"
    | "artworks"
    | "templates"
    | "tryon"
    | "prompts"
    | "api"
    | "auth"
    | "brand"
    | "pages"
    | "ledger"
    | "deploy"
    | "cardkeys"
  >("users");
  const [editCredit, setEditCredit] = useState<{
    email: string;
    value: string;
    months: number; // 赠送有效期:1/3/6/12/24 月,0=永久。仅加分时生效
  } | null>(null);

  function commitCredit(u: AdminUser) {
    if (!editCredit || editCredit.email !== u.email) return;
    const target = Math.trunc(Number(editCredit.value));
    const current = u.creditsTotal - u.creditsUsed;
    const months = editCredit.months;
    setEditCredit(null);
    if (!Number.isFinite(target) || target === current) return;
    const delta = target - current;
    void userAction({
      action: "adjust",
      email: u.email,
      delta,
      // 仅加分(赠送)时带有效期;扣减按现有批次先到期先扣,无需有效期
      ...(delta > 0 ? { months } : {}),
    });
  }

  // 列表内联备注编辑(不必点开详情即可给用户备注名字)
  const [editNote, setEditNote] = useState<{
    email: string;
    value: string;
  } | null>(null);

  function commitNote(u: AdminUser) {
    if (!editNote || editNote.email !== u.email) return;
    const next = editNote.value.slice(0, 1000);
    setEditNote(null);
    if (next === (u.note ?? "")) return;
    void userAction({ action: "note", email: u.email, note: next });
  }

  // Keep page indexes in range when the data set shrinks (e.g. after delete).
  useEffect(() => {
    if (!usersData) return;
    const utp = Math.max(1, Math.ceil(usersData.users.length / USERS_PER_PAGE));
    setUserPage((p) => Math.min(p, utp - 1));
    const ltp = Math.max(
      1,
      Math.ceil(usersData.ledger.length / LEDGER_PER_PAGE)
    );
    setLedgerPage((p) => Math.min(p, ltp - 1));
  }, [usersData]);

  async function openDetail(u: AdminUser) {
    if (!token) return;
    setDetailRow(u);
    setNoteDraft(u.note ?? "");
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(
        `/api/admin/users?email=${encodeURIComponent(u.email)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (res.ok && data.detail) setDetail(data.detail as MemberDetail);
    } catch {
      /* ignore */
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetail(null);
    setDetailRow(null);
  }

  // Group a member's artworks by generation batch so the detail view can show
  // "N 张" per batch. Falls back to id-prefix for pre-batch_id rows.
  const memberBatches = useMemo(() => {
    if (!detail) return [];
    const map = new Map<string, MemberArtwork[]>();
    for (const a of detail.artworks) {
      const key = a.batchId || a.id.replace(/-\d+$/, "");
      const arr = map.get(key);
      if (arr) arr.push(a);
      else map.set(key, [a]);
    }
    return Array.from(map.values());
  }, [detail]);

  // 跟前端"哪些作品进画布"的规则一致:套图/多图批次,或多节点血缘树(同 group_id >1 张)
  // 才进只读画布;单张一次性生图不进画布(点标题只看大图)。
  const canvasGroupSizes = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of detail?.artworks ?? []) {
      const g = a.groupId || a.id;
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  }, [detail]);
  const batchEntersCanvas = (batch: MemberArtwork[]): boolean =>
    batch.length > 1 ||
    batch.some((a) => (canvasGroupSizes.get(a.groupId || a.id) ?? 0) > 1);

  // Keep detailRow (IP / banned status shown in the modal) in sync with the
  // table after a ban/unban action refreshes usersData.
  useEffect(() => {
    if (!detailRow || !usersData) return;
    const fresh = usersData.users.find((x) => x.email === detailRow.email);
    if (
      fresh &&
      (fresh.banned !== detailRow.banned ||
        fresh.lastIp !== detailRow.lastIp ||
        fresh.note !== detailRow.note)
    ) {
      setDetailRow(fresh);
    }
  }, [usersData, detailRow]);

  const loadUsers = useCallback(async (tok: string) => {
    try {
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) setUsersData((await res.json()) as UsersData);
    } catch {
      /* ignore */
    }
  }, []);

  const probe = useCallback(async () => {
    // 本地管理员:无 Supabase token,鉴权靠 HttpOnly cookie(同源请求自动带);
    // 用 "local" 哨兵值填 token,让下游 `if (!token) return` 守卫通过、请求照发
    //(服务端 requireAdmin 先验 cookie,忽略这个无效 Bearer)。
    let tok: string | null = null;
    if (!localAdmin) {
      const sb = browserSupabase();
      const { data } = await sb.auth.getSession();
      tok = data.session?.access_token ?? null;
      if (!tok) return;
    }
    const res = await fetch("/api/admin/settings", {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) return; // 403 -> not admin -> stay hidden
    const v = (await res.json()) as View;
    setToken(tok ?? "local");
    setView(v);
    setModel(v.model);
    setCutoutModel(v.cutoutModel);
    setCutoutBackend(v.cutoutBackend ?? "replicate");
    setReplicateModel(v.cutoutReplicateModel ?? "men1scus/birefnet");
    setBonus(String(v.signupBonus ?? 30));
    // 登录与支付:回填明文字段(敏感字段只看掩码,不回填输入框)
    setWechatAppid(v.wechatAppid ?? "");
    setWechatToken(v.wechatToken ?? "");
    setWechatEmailDomain(v.wechatEmailDomain ?? "");
    setPayEnabled(!!v.payEnabled);
    setMultiUserOn(!!v.multiUserEnabled);
    setSmtpHost(v.smtpHost ?? "");
    setSmtpPort(v.smtpPort || "465");
    setSmtpUser(v.smtpUser ?? "");
    setSmtpFrom(v.smtpFrom ?? "");
    setAlipayAppid(v.alipayAppid ?? "");
    setAlipayPublicKey(v.alipayPublicKey ?? "");
    setWxpayMchid(v.wxpayMchid ?? "");
    setWxpayAppid(v.wxpayAppid ?? "");
    setWxpayCertSerial(v.wxpayCertSerial ?? "");
    setBrandName(v.brandName ?? "");
    setBrandLogo(v.brandLogo ?? "");
    setPageAbout(v.pageAbout ?? "");
    setPageContact(v.pageContact ?? "");
    setPagePlans(v.pagePlans ?? "");
    setIsAdmin(true);
    void loadUsers(tok ?? "local");
  }, [loadUsers, localAdmin]);

  async function userAction(payload: UserActionPayload) {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      setUsersData(data as UsersData);
      setMsg({ ok: true, text: "已更新" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "操作失败" });
    } finally {
      setBusy(false);
    }
  }

  function toggleBan(u: AdminUser) {
    if (
      !u.banned &&
      !window.confirm(
        `确认封禁 ${u.email}？该账号将无法继续生成图片。`
      )
    )
      return;
    void userAction({ action: "ban", email: u.email, banned: !u.banned });
  }

  function removeUser(u: AdminUser) {
    if (
      !window.confirm(
        `确认删除 ${u.email}？将一并删除其作品与积分流水，此操作不可恢复。`
      )
    )
      return;
    void userAction({ action: "delete", email: u.email });
  }

  function banRowIp(ip: string) {
    if (
      !window.confirm(
        `确认封禁 IP ${ip}？该 IP 将无法生成图片（注意：若与你当前 IP 相同会一并封禁你自己）。`
      )
    )
      return;
    void userAction({ action: "ban-ip", ip, reason: "管理员封禁" });
  }

  function addBannedIp() {
    const ip = ipInput.trim();
    if (!ip) return;
    if (
      !window.confirm(
        `确认封禁 IP ${ip}？（注意：若与你当前 IP 相同会一并封禁你自己）`
      )
    )
      return;
    void userAction({ action: "ban-ip", ip, reason: ipReason.trim() });
    setIpInput("");
    setIpReason("");
  }

  useEffect(() => {
    void probe();
  }, [probe]);

  // 非 Pro 时,默认分栏(users)是被门控的 → 落到第一个开放分栏,避免显示空白内容区。
  useEffect(() => {
    if (!pro && PRO_SECTIONS.has(section)) {
      setSection("api");
    }
  }, [pro, section]);

  if (!isAdmin) return null;

  async function save(opts: { withKey: boolean }) {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const payload: {
        model?: string;
        cutoutModel?: string;
        cutoutBackend?: string;
        replicateModel?: string;
        encryptedKey?: string;
      } = { model, cutoutModel, cutoutBackend, replicateModel };
      if (opts.withKey) {
        if (!keyInput.trim()) throw new Error("请输入新的 API Key");
        payload.encryptedKey = await encryptKey(keyInput.trim(), token);
      }
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setView(data as View);
      setModel((data as View).model);
      setCutoutModel((data as View).cutoutModel);
      setCutoutBackend((data as View).cutoutBackend ?? "replicate");
      setReplicateModel(
        (data as View).cutoutReplicateModel ?? "men1scus/birefnet"
      );
      setKeyInput("");
      setMsg({
        ok: true,
        text: opts.withKey ? "Key 已加密更新" : "模型已更新",
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存失败" });
    } finally {
      setBusy(false);
    }
  }

  // 保存「新用户注册赠送积分」
  async function saveBonus() {
    if (!token) return;
    const n = Math.trunc(Number(bonus));
    if (!Number.isFinite(n) || n < 0) {
      setMsg({ ok: false, text: "请输入有效的积分数（≥0 的整数）" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ signupBonus: n }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setView(data as View);
      setBonus(String((data as View).signupBonus ?? n));
      setMsg({ ok: true, text: "新用户注册赠送积分已更新" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存失败" });
    } finally {
      setBusy(false);
    }
  }

  // 保存 Replicate(第三方抠图)Token + 模型(Token 浏览器内 RSA 加密后再传)
  async function saveReplicate() {
    if (!token) return;
    if (!replicateTokenInput.trim()) {
      setMsg({ ok: false, text: "请输入新的 Replicate Token" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const encryptedReplicateToken = await encryptKey(
        replicateTokenInput.trim(),
        token
      );
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ replicateModel, encryptedReplicateToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setView(data as View);
      setReplicateModel((data as View).cutoutReplicateModel ?? replicateModel);
      setReplicateTokenInput("");
      setMsg({ ok: true, text: "Replicate Token 已加密更新" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存失败" });
    } finally {
      setBusy(false);
    }
  }

  // ── 登录与支付板块:统一的 POST + 回填 helper ──
  // payload 里的 encrypted* 字段由调用方先用 encryptKey 在浏览器内加密好。
  async function postSettings(
    payload: Record<string, unknown>,
    okText: string,
    clear?: () => void
  ) {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      const v = data as View;
      setView(v);
      // 用回包的安全视图同步明文回显(敏感字段只看掩码)
      setWechatAppid(v.wechatAppid ?? "");
      setWechatToken(v.wechatToken ?? "");
      setWechatEmailDomain(v.wechatEmailDomain ?? "");
      setPayEnabled(!!v.payEnabled);
    setMultiUserOn(!!v.multiUserEnabled);
    setSmtpHost(v.smtpHost ?? "");
    setSmtpPort(v.smtpPort || "465");
    setSmtpUser(v.smtpUser ?? "");
    setSmtpFrom(v.smtpFrom ?? "");
      setAlipayAppid(v.alipayAppid ?? "");
      setAlipayPublicKey(v.alipayPublicKey ?? "");
      setWxpayMchid(v.wxpayMchid ?? "");
      setWxpayAppid(v.wxpayAppid ?? "");
      setWxpayCertSerial(v.wxpayCertSerial ?? "");
      setBrandName(v.brandName ?? "");
      setBrandLogo(v.brandLogo ?? "");
      clear?.();
      setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存失败" });
    } finally {
      setBusy(false);
    }
  }

  // 保存微信登录明文字段(AppID / Token / 邮箱域名)
  async function saveWechatLogin() {
    await postSettings(
      {
        wechatAppid,
        wechatToken,
        wechatEmailDomain,
      },
      "微信登录已保存"
    );
  }

  // 保存品牌与白标(Pro):站点名称 / Logo URL。明文;空串=清除覆盖→回退默认。
  // 用 postSettings 走同一 POST + 回填(它会读回包同步 brandName/brandLogo)。
  async function saveBrandName() {
    await postSettings({ brandName }, "站点名称已保存");
  }
  async function saveBrandLogo() {
    await postSettings({ brandLogo }, "Logo 已保存");
  }

  // 保存站点页面(关于/联系/定价)。空串=清空→前台回退默认。
  async function saveSitePages() {
    await postSettings(
      { pageAbout, pageContact, pagePlans },
      "站点页面已保存"
    );
  }

  // 上传 Logo 图片 → 存储返回 URL → 落库 brand_logo(与手填 URL 同一个值)。
  async function uploadBrandLogo(file: File) {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    let url = "";
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/admin/brand-logo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "上传失败");
      url = data.url as string;
      setBrandLogo(url);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "上传失败" });
      setBusy(false);
      return;
    }
    // 上传成功 → 直接落库(postSettings 自管 busy/msg)。
    await postSettings({ brandLogo: url }, "Logo 已上传并保存");
  }

  // 加密更新一个敏感字段(浏览器内 RSA 加密 → POST 对应 encrypted* 字段)
  async function saveEncrypted(
    fieldName: string,
    plain: string,
    okText: string,
    clear: () => void
  ) {
    if (!token) return;
    if (!plain.trim()) {
      setMsg({ ok: false, text: "请输入内容" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const enc = await encryptKey(plain.trim(), token);
      await postSettings({ [fieldName]: enc }, okText, clear);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存失败" });
      setBusy(false);
    }
  }

  // 各收款/登录块「是否已生效」——用于卡片头部状态徽标(已生效 / 未生效)。
  const alipayReady = !!view?.alipayAppid && !!view?.alipayPrivateKeyReady;
  const wxpayReady =
    !!view?.wxpayMchid &&
    !!view?.wxpayAppid &&
    !!view?.wxpayCertSerial &&
    !!view?.wxpayApiv3Ready &&
    !!view?.wxpayCertReady;
  // 收款「实际生效」= 总开关已开 且 至少一个商户齐全(前端真正显示在线充值的条件)。
  const payLive = !!view?.payEnabled && (alipayReady || wxpayReady);

  return (
    <div className="mt-6">
      {/* 统一大卡:左导航 + 右内容同框,竖线分隔,两列边框天然对齐 */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card card-shadow lg:flex-row">
        {/* 左侧分栏导航(方案 A) */}
        <nav className="flex flex-row gap-1 overflow-x-auto border-b border-border bg-card p-2 lg:w-52 lg:flex-none lg:flex-col lg:border-b-0 lg:border-r">
          {SECTIONS.filter((s) => pro || !s.pro).map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={`flex flex-none items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${
                  section === s.id
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-secondary"
                }`}
              >
                <Icon className="h-4 w-4 flex-none" />
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* 内容区:一次只显示一个板块(浅灰底,白卡片落其上更清爽) */}
        <div className="min-w-0 flex-1 bg-secondary/30 p-5 sm:p-6">
      {msg && (
        <p
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            msg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-600"
          }`}
        >
          {msg.text}
        </p>
      )}

      {/* 用户与会员管理(Pro:运营/多用户向) */}
      {pro && section === "users" && (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">用户与会员管理</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              仅管理员可见
            </span>
          </div>
          {token && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadUsers(token)}
              disabled={busy}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </Button>
          )}
        </div>

        {!usersData ? (
          <div className="rounded-2xl border border-border bg-card py-12 text-center text-sm text-muted-foreground card-shadow">
            加载中…
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Users, label: "用户数", value: usersData.stats.users },
                {
                  icon: ImageIcon,
                  label: "作品数",
                  value: usersData.stats.artworks,
                },
                {
                  icon: Database,
                  label: "剩余积分",
                  value: usersData.stats.remaining,
                },
                {
                  icon: Crown,
                  label: "本月消耗",
                  value: usersData.stats.used,
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl border border-border bg-card p-5 card-shadow"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <p className="mt-3 text-2xl font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>

            {/* 新用户注册赠送积分(后台可配) */}
            <div className="rounded-2xl border border-border bg-card p-6 card-shadow">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                <Crown className="h-4 w-4 text-primary" />
                新用户注册赠送积分
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                每个新用户首次注册时自动赠送的积分，30 天有效。设为 0 则不赠送。
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={bonus}
                  disabled={busy}
                  onChange={(e) => setBonus(e.target.value)}
                  className="w-28 rounded-md border border-border px-3 py-2 text-sm"
                />
                <span className="text-sm text-muted-foreground">积分</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void saveBonus()}
                  disabled={busy}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  保存
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border bg-card card-shadow">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b border-border text-left text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">用户</th>
                    <th className="px-5 py-3 font-medium">角色</th>
                    <th className="px-5 py-3 font-medium">积分</th>
                    <th className="px-5 py-3 font-medium">作品</th>
                    <th className="px-5 py-3 font-medium">近 7 天消耗</th>
                    <th className="px-5 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {usersData.users
                    .slice(
                      userPage * USERS_PER_PAGE,
                      userPage * USERS_PER_PAGE + USERS_PER_PAGE
                    )
                    .map((u) => (
                    <tr
                      key={u.email}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-5 py-3">
                        <div className="font-semibold">{u.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {u.email}
                        </div>
                        {editNote?.email === u.email ? (
                          <input
                            type="text"
                            autoFocus
                            value={editNote.value}
                            disabled={busy}
                            placeholder="备注名字…回车保存"
                            onChange={(e) =>
                              setEditNote({
                                email: u.email,
                                value: e.target.value,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitNote(u);
                              if (e.key === "Escape") setEditNote(null);
                            }}
                            onBlur={() => commitNote(u)}
                            className="mt-1 w-[200px] rounded-md border border-border px-2 py-1 text-xs"
                          />
                        ) : u.note ? (
                          <button
                            onClick={() =>
                              setEditNote({ email: u.email, value: u.note })
                            }
                            title="点击编辑备注"
                            className="mt-1 block max-w-[220px] truncate text-left text-xs text-amber-600 hover:underline"
                          >
                            📝 {u.note}
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              setEditNote({ email: u.email, value: "" })
                            }
                            className="mt-1 text-xs text-muted-foreground/60 hover:text-primary"
                          >
                            ＋ 备注
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <SelectMenu
                          size="sm"
                          value={u.role}
                          disabled={busy}
                          onChange={(v) =>
                            void userAction({
                              action: "role",
                              email: u.email,
                              role: v,
                            })
                          }
                          options={[
                            { value: "user", label: "user" },
                            { value: "admin", label: "admin" },
                          ]}
                        />
                      </td>
                      <td className="px-5 py-3">
                        {editCredit?.email === u.email ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              autoFocus
                              value={editCredit.value}
                              disabled={busy}
                              onChange={(e) =>
                                setEditCredit({
                                  email: u.email,
                                  value: e.target.value,
                                  months: editCredit.months,
                                })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitCredit(u);
                                if (e.key === "Escape") setEditCredit(null);
                              }}
                              className="w-16 rounded-md border border-border px-2 py-1 text-xs"
                            />
                            {/* 赠送(调高)时的有效期;调低=扣减,有效期不生效 */}
                            <select
                              value={editCredit.months}
                              disabled={busy}
                              title="赠送积分有效期(仅加分时生效)"
                              onChange={(e) =>
                                setEditCredit({
                                  email: u.email,
                                  value: editCredit.value,
                                  months: Number(e.target.value),
                                })
                              }
                              className="rounded-md border border-border px-1 py-1 text-xs"
                            >
                              <option value={1}>1个月</option>
                              <option value={3}>3个月</option>
                              <option value={6}>6个月</option>
                              <option value={12}>12个月</option>
                              <option value={24}>2年</option>
                              <option value={0}>永久</option>
                            </select>
                            <button
                              disabled={busy}
                              onClick={() => commitCredit(u)}
                              aria-label="确认"
                              className="rounded-md border border-emerald-300 p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setEditCredit(null)}
                              aria-label="取消"
                              className="rounded-md border border-border p-1 text-muted-foreground hover:bg-secondary"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() =>
                              setEditCredit({
                                email: u.email,
                                value: String(
                                  u.creditsTotal - u.creditsUsed
                                ),
                                months: 1,
                              })
                            }
                            title="点击编辑积分"
                            className="rounded font-semibold underline-offset-2 hover:underline"
                          >
                            {u.creditsTotal - u.creditsUsed}
                          </button>
                        )}
                      </td>
                      <td className="px-5 py-3">{u.artworks}</td>
                      <td className="px-5 py-3">
                        <span
                          className={
                            u.recent7 > 0
                              ? "font-semibold text-foreground"
                              : "text-muted-foreground"
                          }
                        >
                          {u.recent7}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          积分
                        </span>
                        {u.banned && (
                          <span className="ml-2 inline-flex w-fit items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 align-middle">
                            <Ban className="h-2.5 w-2.5" />
                            封禁
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={busy}
                            onClick={() => void openDetail(u)}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary disabled:opacity-50"
                          >
                            <Eye className="h-3 w-3" />
                            查看
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => removeUser(u)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2 className="h-3 w-3" />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={userPage}
              totalPages={Math.max(
                1,
                Math.ceil(usersData.users.length / USERS_PER_PAGE)
              )}
              onChange={setUserPage}
              totalLabel={`共 ${usersData.users.length} 位用户`}
            />

            {/* 已封禁 IP 管理 */}
            <div className="rounded-2xl border border-border bg-card p-6 card-shadow">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Globe className="h-4 w-4 text-primary" />
                已封禁 IP 管理
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={ipInput}
                  onChange={(e) => setIpInput(e.target.value)}
                  placeholder="要封禁的 IP，例如 203.0.113.7"
                  className="sm:max-w-[220px]"
                />
                <Input
                  value={ipReason}
                  onChange={(e) => setIpReason(e.target.value)}
                  placeholder="备注（可选）"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addBannedIp}
                  disabled={busy || !ipInput.trim()}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  封禁 IP
                </Button>
              </div>
              {usersData.bannedIps.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  暂无封禁的 IP。
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {usersData.bannedIps.map((b) => (
                    <li
                      key={b.ip}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <code className="font-medium">{b.ip}</code>
                        <div className="truncate text-xs text-muted-foreground">
                          {b.reason || "无备注"} ·{" "}
                          {new Date(b.createdAt).toLocaleString("zh-CN")}
                        </div>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void userAction({
                            action: "unban-ip",
                            ip: b.ip,
                          })
                        }
                        className="shrink-0 rounded-md border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        解封
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      )}

      {/* 模板管理 */}
      {section === "templates" && <AdminTemplates token={token} />}

      {pro && section === "tryon" && <AdminTryon token={token} />}

      {/* 全部作品(Pro:浏览全体用户作品,运营/多用户向) */}
      {pro && section === "artworks" && <AdminArtworks token={token} />}

      {/* 提示词配置 */}
      {section === "prompts" && <AdminPrompts />}

      {/* 管理员 · OpenAI 接口设置 */}
      {section === "api" && (
      <div>
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">管理员 · 接口与模型</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            仅管理员可见
          </span>
        </div>

        {/* 大陆服务器中转部署帮助 */}
        <div className="mb-5 rounded-xl border border-c-border2 bg-c-subtle2 p-4 text-[13px] leading-relaxed">
          <p className="font-semibold text-c-text">
            🇨🇳 大陆服务器:生图报「无法连接 AI 服务」怎么办
          </p>
          <p className="mt-1.5 text-c-text3">
            大陆服务器直连不了 AI 模型,需要配置「中转地址」(反代)才能生图。两种办法:
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-c-text3">
            <li>
              用一台海外服务器自建 OpenAI 兼容的中转/反代,把地址填到运行环境变量{" "}
              <code className="rounded bg-black/5 px-1 dark:bg-white/10">
                OPENAI_BASE_URL
              </code>
              (compose 里加这行后 <code className="rounded bg-black/5 px-1 dark:bg-white/10">docker compose up -d</code> 重启)。
            </li>
            <li>
              不想折腾:联系作者微信 <b className="text-c-text2">xingze063</b>,可付费代配中转 / 代部署。
            </li>
          </ul>
          <p className="mt-1.5 text-c-text4">海外服务器一般直连即可,忽略本条。</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* 左:图像模型 + 对应 OpenAI Key + 充值入口 */}
          <div className="space-y-3 rounded-2xl border border-border bg-card p-6 card-shadow">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Cpu className="h-4 w-4 text-primary" />
              图像模型
            </div>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="例如 gpt-image-2"
            />
            <div className="flex flex-wrap gap-2">
              {MODELS.map((m) => (
                <button
                  key={m}
                  onClick={() => setModel(m)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    model === m
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void save({ withKey: false })}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              保存图像模型
            </Button>

            {/* OpenAI API Key(图像模型对应的 key) */}
            <div className="mt-2 flex items-center gap-2 border-t border-border pt-3 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-primary" />
              OpenAI API Key
            </div>
            <p className="text-sm text-muted-foreground">
              当前：
              <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                {view?.hasKey ? view.keyMasked : "未设置"}
              </code>
              <span className="ml-2 text-xs">
                来源：
                {view?.source === "db"
                  ? "后台"
                  : view?.source === "env"
                    ? "环境变量"
                    : "无"}
              </span>
            </p>
            <Input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="粘贴新的 sk-...（提交前浏览器内 RSA 加密）"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                浏览器内 RSA 加密传输 + 服务端 AES 加密存储，永不明文
              </p>
              <Button
                variant="gradient"
                size="sm"
                onClick={() => void save({ withKey: true })}
                disabled={busy || !keyInput.trim()}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                加密更新 Key
              </Button>
            </div>
            <a
              href={OPENAI_TOPUP_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              前往 OpenAI 充值
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* 右:抠图模型(后端 / Replicate / 兜底)+ 对应 Token + 充值入口 */}
          <div className="space-y-3 rounded-2xl border border-border bg-card p-6 card-shadow">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Scissors className="h-4 w-4 text-primary" />
              抠图模型
            </div>
            <p className="text-xs text-muted-foreground">
              「AI 抠图」与画布抠图主用 Replicate BiRefNet(发丝级、像素保真,按次付费
              ~¥0.03/张);gpt-image 会重绘主体、慢且烧 token,仅作兜底。选「Replicate」=
              主用 BiRefNet、失败自动退 gpt-image;选「gpt-image」=强制走兜底。
            </p>
            {/* 后端切换 */}
            <div className="flex flex-wrap gap-2">
              {[
                { id: "replicate" as const, label: "Replicate BiRefNet(主)" },
                { id: "openai" as const, label: "OpenAI gpt-image(兜底)" },
              ].map((b) => (
                <button
                  key={b.id}
                  onClick={() => setCutoutBackend(b.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    cutoutBackend === b.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {/* Replicate BiRefNet(第三方,后台可改 Token + 模型) */}
            <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
              <div className="flex items-center justify-between text-xs font-medium">
                <span>Replicate BiRefNet(第三方)</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                    view?.cutoutReplicateReady
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-amber-500/10 text-amber-600"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      view?.cutoutReplicateReady ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  {view?.cutoutReplicateReady
                    ? `已配置 · ${view.cutoutReplicateTokenMasked || "••••"}`
                    : "未配置 Token"}
                </span>
              </div>
              <label className="block text-[11px] font-medium text-muted-foreground">
                模型 slug
              </label>
              <Input
                value={replicateModel}
                onChange={(e) => setReplicateModel(e.target.value)}
                placeholder="men1scus/birefnet"
              />
              <label className="block text-[11px] font-medium text-muted-foreground">
                API Token
              </label>
              <Input
                type="password"
                value={replicateTokenInput}
                onChange={(e) => setReplicateTokenInput(e.target.value)}
                placeholder="粘贴新的 r8_…（提交前浏览器内 RSA 加密）"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  RSA 加密传输 + AES 加密存储,永不明文、不回显
                </p>
                <Button
                  variant="gradient"
                  size="sm"
                  onClick={() => void saveReplicate()}
                  disabled={busy || !replicateTokenInput.trim()}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  加密更新 Token
                </Button>
              </div>
            </div>

            {/* gpt-image 兜底模型 */}
            <p className="text-xs font-medium text-muted-foreground">
              gpt-image 兜底模型
            </p>
            <Input
              value={cutoutModel}
              onChange={(e) => setCutoutModel(e.target.value)}
              placeholder="例如 gpt-image-1"
            />
            <div className="flex flex-wrap gap-2">
              {["gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5", "gpt-image-2"].map(
                (m) => (
                  <button
                    key={m}
                    onClick={() => setCutoutModel(m)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      cutoutModel === m
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    {m}
                  </button>
                )
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void save({ withKey: false })}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              保存抠图设置
            </Button>
            <a
              href={REPLICATE_TOPUP_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              前往 Replicate 充值
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
      )}

      {/* 管理员 · 登录与支付(Pro:收款/变现 + 微信登录配置) */}
      {pro && section === "auth" && (
      <div>
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">管理员 · 登录与支付</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            仅管理员可见
          </span>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          开源自部署时在此填入自己的微信公众号与收款凭证。所有敏感字段均「浏览器内 RSA
          加密传输 + 服务端 AES 加密存储」，永不明文、不回显；留空则自动回退环境变量配置。
        </p>

        {/* 多用户模式开关(Pro:开则访客注册/买积分/生图扣费,可对外运营卖积分) */}
        <div className="mb-5 space-y-3 rounded-2xl border border-border bg-card p-6 card-shadow">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-primary" />
            多用户模式
          </div>
          <p className="text-xs text-muted-foreground">
            开启后：访客可注册 / 登录（邮箱 + 密码），新用户获赠积分，生图按积分扣费，
            你可对外卖积分运营（和官方站一样）。关闭则为单用户自托管（仅你自己用、不计费）。
            开启前请先在下方配好收款（支付宝 / 微信），否则用户买不了积分。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              多用户开关：
            </span>
            {[
              { v: true, label: "开启" },
              { v: false, label: "关闭" },
            ].map((o) => (
              <button
                key={o.label}
                onClick={() => setMultiUserOn(o.v)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  multiUserOn === o.v
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                }`}
              >
                {o.label}
              </button>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void postSettings(
                  { multiUserEnabled: multiUserOn },
                  "多用户开关已保存"
                )
              }
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              保存
            </Button>
          </div>
        </div>

        {/* 邮件服务(SMTP,忘记密码用) */}
        <div className="mb-5 space-y-3 rounded-2xl border border-border bg-card p-6 card-shadow">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="h-4 w-4 text-primary" />
            邮件服务（SMTP）
            <ReadyBadge ready={!!view?.smtpConfigured} className="ml-auto" />
          </div>
          <p className="text-xs text-muted-foreground">
            用于多用户「忘记密码」发送重置邮件。填你的 SMTP（企业邮箱 / 阿里云邮件推送等）。
            密码加密存储、不回显。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground">
                SMTP 服务器
              </label>
              <Input
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.exmail.qq.com"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground">
                端口
              </label>
              <Input
                value={smtpPort}
                inputMode="numeric"
                onChange={(e) =>
                  setSmtpPort(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="465"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground">
                账号（用户名）
              </label>
              <Input
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="noreply@yourdomain.com"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground">
                密码 / 授权码
                {view?.smtpConfigured ? "（已保存，留空不改）" : ""}
              </label>
              <Input
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-muted-foreground">
                发件人（可选，默认用账号）
              </label>
              <Input
                value={smtpFrom}
                onChange={(e) => setSmtpFrom(e.target.value)}
                placeholder='"你的站点" <noreply@yourdomain.com>'
              />
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void postSettings(
                {
                  smtpHost,
                  smtpPort: Number(smtpPort) || 465,
                  smtpUser,
                  smtpFrom,
                  smtpPass,
                },
                "邮件配置已保存",
                () => setSmtpPass("")
              )
            }
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            保存邮件配置
          </Button>
        </div>

        {/* 当前收款模式(只读说明) */}
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" />
          <span>当前：原生对接模式（填好下方商户即可直接收款）。</span>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* 卡 1:微信登录 */}
          <div className="space-y-3 rounded-2xl border border-border bg-card p-6 card-shadow">
            <div className="flex items-center justify-between gap-2 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                微信登录（公众号扫码）
              </span>
              <ReadyBadge ready={!!view?.wechatReady} />
            </div>
            <label className="block text-[11px] font-medium text-muted-foreground">
              AppID
            </label>
            <Input
              value={wechatAppid}
              onChange={(e) => setWechatAppid(e.target.value)}
              placeholder="wx 开头的公众号 AppID"
            />
            <label className="block text-[11px] font-medium text-muted-foreground">
              Token（服务器配置里的令牌）
            </label>
            <Input
              value={wechatToken}
              onChange={(e) => setWechatToken(e.target.value)}
              placeholder="回调验签用的 Token"
            />
            <label className="block text-[11px] font-medium text-muted-foreground">
              合成邮箱域名
            </label>
            <Input
              value={wechatEmailDomain}
              onChange={(e) => setWechatEmailDomain(e.target.value)}
              placeholder="wx.starzeco.com"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void saveWechatLogin()}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              保存微信登录
            </Button>

            {/* AppSecret(加密) */}
            <div className="mt-1 flex items-center justify-between border-t border-border pt-3 text-xs font-medium">
              <span className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-primary" />
                AppSecret
              </span>
              <span className="text-muted-foreground">
                当前：{view?.wechatReady ? view?.wechatSecretMasked || "••••" : "未设置"}
              </span>
            </div>
            <Input
              type="password"
              value={wechatSecretInput}
              onChange={(e) => setWechatSecretInput(e.target.value)}
              placeholder="粘贴新的 AppSecret（提交前浏览器内 RSA 加密）"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                RSA 加密传输 + AES 加密存储，永不明文、不回显
              </p>
              <Button
                variant="gradient"
                size="sm"
                onClick={() =>
                  void saveEncrypted(
                    "encryptedWechatSecret",
                    wechatSecretInput,
                    "微信 AppSecret 已加密更新",
                    () => setWechatSecretInput("")
                  )
                }
                disabled={busy || !wechatSecretInput.trim()}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                加密更新 Secret
              </Button>
            </div>
          </div>

          {/* 卡 2:收款总开关 */}
          <div className="space-y-3 rounded-2xl border border-border bg-card p-6 card-shadow">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-primary" />
              收款总开关
              <ReadyBadge ready={payLive} className="ml-auto" />
            </div>
            <p className="text-xs text-muted-foreground">
              控制前端是否显示「在线充值」（需同时已配置收款信息：支付宝或微信商户齐全）。
            </p>
            {/* 收款开关 */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                收款总开关：
              </span>
              {[
                { v: true, label: "开启" },
                { v: false, label: "关闭" },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => setPayEnabled(o.v)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    payEnabled === o.v
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {o.label}
                </button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void postSettings({ payEnabled }, "收款开关已保存")
                }
                disabled={busy}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                保存开关
              </Button>
            </div>
          </div>

          {/* 卡 3:支付宝商户 */}
          <div className="space-y-3 rounded-2xl border border-border bg-card p-6 card-shadow">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-primary" />
              支付宝商户
              <ReadyBadge ready={alipayReady} className="ml-auto" />
            </div>
            <label className="block text-[11px] font-medium text-muted-foreground">
              AppID
            </label>
            <Input
              value={alipayAppid}
              onChange={(e) => setAlipayAppid(e.target.value)}
              placeholder="支付宝应用 AppID"
            />
            <label className="block text-[11px] font-medium text-muted-foreground">
              支付宝公钥
            </label>
            <Input
              value={alipayPublicKey}
              onChange={(e) => setAlipayPublicKey(e.target.value)}
              placeholder="支付宝公钥（非敏感，可明文存）"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void postSettings(
                  { alipayAppid, alipayPublicKey },
                  "支付宝商户已保存"
                )
              }
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              保存支付宝商户
            </Button>

            {/* 应用私钥(加密) */}
            <div className="mt-1 flex items-center justify-between border-t border-border pt-3 text-xs font-medium">
              <span className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-primary" />
                应用私钥
              </span>
              <span className="text-muted-foreground">
                当前：
                {view?.alipayPrivateKeyReady
                  ? view?.alipayPrivateKeyMasked || "••••"
                  : "未设置"}
              </span>
            </div>
            <textarea
              value={alipayPrivateKeyInput}
              onChange={(e) => setAlipayPrivateKeyInput(e.target.value)}
              placeholder="粘贴应用私钥（提交前浏览器内 RSA 加密）"
              rows={3}
              className="w-full resize-y rounded-lg border border-border bg-card p-2.5 text-sm outline-none focus:border-primary"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                RSA 加密传输 + AES 加密存储，永不明文、不回显
              </p>
              <Button
                variant="gradient"
                size="sm"
                onClick={() =>
                  void saveEncrypted(
                    "encryptedAlipayPrivateKey",
                    alipayPrivateKeyInput,
                    "支付宝应用私钥已加密更新",
                    () => setAlipayPrivateKeyInput("")
                  )
                }
                disabled={busy || !alipayPrivateKeyInput.trim()}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                加密更新私钥
              </Button>
            </div>

            {/* 排错:从已存私钥反推出的应用公钥,须与支付宝平台上传的「应用公钥」一致 */}
            {view?.alipayDerivedPublicKey && (
              <div className="mt-1 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="mb-1 text-[11px] font-semibold text-amber-700">
                  🔍 排错 · 你私钥对应的「应用公钥」
                </p>
                <p className="mb-2 text-[11px] leading-relaxed text-amber-700">
                  下面这串,必须和你上传到支付宝平台「接口加签方式 →
                  应用公钥」里的<b>一字不差</b>。不一致 =
                  验签出错的根因(私钥与平台上传的公钥不是一对)。点框内全选复制去对照。
                </p>
                <textarea
                  readOnly
                  value={view.alipayDerivedPublicKey}
                  rows={3}
                  onClick={(e) =>
                    (e.target as HTMLTextAreaElement).select()
                  }
                  className="w-full resize-y rounded-md border border-amber-300 bg-white p-2 font-mono text-[11px] text-amber-900 outline-none"
                />
              </div>
            )}
          </div>

          {/* 卡 4:微信支付商户 */}
          <div className="space-y-3 rounded-2xl border border-border bg-card p-6 card-shadow">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-primary" />
              微信支付商户
              <ReadyBadge ready={wxpayReady} className="ml-auto" />
            </div>
            <label className="block text-[11px] font-medium text-muted-foreground">
              商户号 mchid
            </label>
            <Input
              value={wxpayMchid}
              onChange={(e) => setWxpayMchid(e.target.value)}
              placeholder="微信支付商户号 mchid"
            />
            <label className="block text-[11px] font-medium text-muted-foreground">
              绑定 AppID（公众号 / 小程序）
            </label>
            <Input
              value={wxpayAppid}
              onChange={(e) => setWxpayAppid(e.target.value)}
              placeholder="Native 下单绑定的 appid"
            />
            <label className="block text-[11px] font-medium text-muted-foreground">
              证书序列号
            </label>
            <Input
              value={wxpayCertSerial}
              onChange={(e) => setWxpayCertSerial(e.target.value)}
              placeholder="商户证书序列号 serial_no"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void postSettings(
                  { wxpayMchid, wxpayAppid, wxpayCertSerial },
                  "微信支付商户已保存"
                )
              }
              disabled={busy || !wxpayMchid.trim()}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              保存微信支付商户
            </Button>

            {/* APIv3 Key(加密) */}
            <div className="mt-1 flex items-center justify-between border-t border-border pt-3 text-xs font-medium">
              <span className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-primary" />
                APIv3 Key
              </span>
              <span className="text-muted-foreground">
                当前：
                {view?.wxpayApiv3Ready ? view?.wxpayApiv3Masked || "••••" : "未设置"}
              </span>
            </div>
            <Input
              type="password"
              value={wxpayApiv3Input}
              onChange={(e) => setWxpayApiv3Input(e.target.value)}
              placeholder="粘贴 APIv3 Key（提交前浏览器内 RSA 加密）"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="gradient"
                size="sm"
                onClick={() =>
                  void saveEncrypted(
                    "encryptedWxpayApiv3",
                    wxpayApiv3Input,
                    "微信支付 APIv3 Key 已加密更新",
                    () => setWxpayApiv3Input("")
                  )
                }
                disabled={busy || !wxpayApiv3Input.trim()}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                加密更新 APIv3
              </Button>
            </div>

            {/* 商户 API 私钥 apiclient_key.pem(加密) */}
            <div className="mt-1 flex items-center justify-between border-t border-border pt-3 text-xs font-medium">
              <span className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-primary" />
                商户 API 私钥(apiclient_key.pem)
              </span>
              <span className="text-muted-foreground">
                当前：
                {view?.wxpayCertReady ? view?.wxpayCertMasked || "••••" : "未设置"}
              </span>
            </div>
            <textarea
              value={wxpayCertInput}
              onChange={(e) => setWxpayCertInput(e.target.value)}
              placeholder="粘贴 apiclient_key.pem 全文（提交前浏览器内 RSA 加密）"
              rows={3}
              className="w-full resize-y rounded-lg border border-border bg-card p-2.5 text-sm outline-none focus:border-primary"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                RSA 加密传输 + AES 加密存储，永不明文、不回显
              </p>
              <Button
                variant="gradient"
                size="sm"
                onClick={() =>
                  void saveEncrypted(
                    "encryptedWxpayCert",
                    wxpayCertInput,
                    "微信支付商户证书已加密更新",
                    () => setWxpayCertInput("")
                  )
                }
                disabled={busy || !wxpayCertInput.trim()}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                加密更新证书
              </Button>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* 管理员 · 品牌与站点(自定义站点名 / Logo,运行时 DB 覆盖,免重建镜像)。
          基础品牌(名+Logo)开源版即可用;仅"去掉底部 Powered by 署名"需要 Pro。 */}
      {section === "brand" && (
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">管理员 · 品牌与站点</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            仅管理员可见
          </span>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          自定义站点名称与 Logo,留空则用默认。此处修改即时生效,无需重新部署。
          {!pro && (
            <span className="text-c-text3">
              {" "}页脚「Powered by」署名的移除为 Pro 版能力。
            </span>
          )}
        </p>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* 站点名称(复用首启向导的 site_name) */}
          <div className="space-y-3 rounded-2xl border border-border bg-card p-6 card-shadow">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Palette className="h-4 w-4 text-primary" />
              站点名称
            </div>
            <p className="text-xs text-muted-foreground">
              显示在导航栏 Logo 旁与页脚版权。留空则回退默认。
            </p>
            <Input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="例如 星泽商图"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void saveBrandName()}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              保存站点名称
            </Button>
          </div>

          {/* Logo 图片(上传 或 填 URL) */}
          <div className="space-y-3 rounded-2xl border border-border bg-card p-6 card-shadow">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ImageIcon className="h-4 w-4 text-primary" />
              Logo 图片
            </div>
            <p className="text-xs text-muted-foreground">
              上传图片,或手填站内路径(如 /logo.png)/ 图床 URL。留空则回退默认 Logo。
            </p>
            <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-3">
              <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                建议:<b>PNG(透明底)</b>或 WebP,横版 wordmark 高约 <b>80–128px</b>、
                宽 ≤ 400px;方形图标 <b>128×128</b> 起。文件 &lt; 2MB。上传会自动压到
                合适尺寸并保存(导航栏按高度约 32px 显示,建议 2 倍图更清晰)。
              </p>
              <label
                className={`inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors ${
                  busy
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer text-muted-foreground hover:border-primary hover:text-primary"
                }`}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                上传图片
                <input
                  type="file"
                  accept="image/png,image/webp,image/jpeg,image/svg+xml"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadBrandLogo(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <Input
              value={brandLogo}
              onChange={(e) => setBrandLogo(e.target.value)}
              placeholder="或手填:/logo.png 或 https://…/logo.png"
            />
            {brandLogo.trim() && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={brandLogo.trim()}
                  alt="Logo 预览"
                  className="h-8 w-auto rounded-lg"
                />
                <span className="text-xs text-muted-foreground">预览</span>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void saveBrandLogo()}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              保存 Logo
            </Button>
          </div>
        </div>
      </div>
      )}

      {/* 管理员 · 站点页面(关于/联系/定价 自定义内容;开源版也可改) */}
      {section === "pages" && (
      <div>
        <div className="mb-3 flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">管理员 · 站点页面</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            仅管理员可见
          </span>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          自定义「关于我们 / 联系我们 / 定价」页面内容(纯文本,空一行分段)。
          留空则显示「内容建设中」。改动即时生效。
        </p>

        <div className="space-y-5">
          <div className="space-y-2 rounded-2xl border border-border bg-card p-6 card-shadow">
            <label className="text-sm font-semibold">关于我们</label>
            <Textarea
              rows={6}
              value={pageAbout}
              onChange={(e) => setPageAbout(e.target.value)}
              placeholder="介绍你的团队 / 公司 / 产品…"
            />
          </div>
          <div className="space-y-2 rounded-2xl border border-border bg-card p-6 card-shadow">
            <label className="text-sm font-semibold">联系我们</label>
            <Textarea
              rows={5}
              value={pageContact}
              onChange={(e) => setPageContact(e.target.value)}
              placeholder="邮箱 / 微信 / 电话 / 地址 / 工作时间…"
            />
          </div>
          <div className="space-y-2 rounded-2xl border border-border bg-card p-6 card-shadow">
            <label className="text-sm font-semibold">定价</label>
            <Textarea
              rows={5}
              value={pagePlans}
              onChange={(e) => setPagePlans(e.target.value)}
              placeholder="套餐 / 价格 / 权益说明…(留空则该页显示「内容建设中」)"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void saveSitePages()}
            disabled={busy}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            保存站点页面
          </Button>
        </div>
      </div>
      )}

      {/* 部署与授权(Pro:运营/站长向,合并「部署中心」+「授权管理」两块内容) */}
      {pro && section === "deploy" && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">部署与授权</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              仅管理员可见
            </span>
          </div>

          {/* 部署中心 */}
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Server className="h-4 w-4 text-primary" />
            部署中心
          </div>
          <DeployCenter embedded />

          {/* 分隔 + 授权管理 */}
          <div className="mt-8 border-t border-border pt-6">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <KeyRound className="h-4 w-4 text-primary" />
              授权管理
            </div>
            <LicensesClient embedded />
          </div>
        </div>
      )}

      {/* 兑换码(Pro:运营/站长向) */}
      {pro && section === "cardkeys" && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">兑换码</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              仅管理员可见
            </span>
          </div>
          <CardkeysAdmin embedded />
        </div>
      )}

      {/* 积分流水(Pro:变现/运营) */}
      {pro && section === "ledger" && usersData && usersData.ledger.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">最近积分流水</h2>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 card-shadow">
            <ul className="divide-y divide-border">
              {usersData.ledger
                .slice(
                  ledgerPage * LEDGER_PER_PAGE,
                  ledgerPage * LEDGER_PER_PAGE + LEDGER_PER_PAGE
                )
                .map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between py-2.5 text-sm"
                  >
                    <div>
                      <div className="font-medium">{l.reason}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.email} ·{" "}
                        {new Date(l.createdAt).toLocaleString("zh-CN")}
                      </div>
                    </div>
                    <span
                      className={`font-semibold ${
                        l.delta >= 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {l.delta >= 0 ? "+" : ""}
                      {l.delta} 积分
                    </span>
                  </li>
                ))}
            </ul>
            <Pager
              page={ledgerPage}
              totalPages={Math.max(
                1,
                Math.ceil(usersData.ledger.length / LEDGER_PER_PAGE)
              )}
              onChange={setLedgerPage}
              totalLabel={`共 ${usersData.ledger.length} 条`}
            />
          </div>
        </div>
      )}
        </div>
      </div>

      {/* 会员详情:右侧抽屉(点列表里某行滑出,点遮罩或×收起) */}
      {(detailRow || detail || detailLoading) && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/50"
          onClick={closeDetail}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="drawer-in h-full w-full max-w-xl overflow-y-auto bg-card p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">
                  会员详情
                  {detailRow ? ` · ${detailRow.name}` : ""}
                </h3>
                <p className="truncate text-xs text-muted-foreground">
                  {detailRow?.email ?? detail?.email}
                </p>
              </div>
              <button
                onClick={closeDetail}
                aria-label="关闭"
                className="shrink-0 rounded-md p-1 hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailRow && (
              <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
                <Globe className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-muted-foreground">登录 IP：</span>
                <code className="font-medium">{detailRow.lastIp ?? "—"}</code>
                {detailRow.banned && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    <Ban className="h-3 w-3" />
                    已封禁
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => toggleBan(detailRow)}
                    className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
                      detailRow.banned
                        ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        : "border-amber-300 text-amber-700 hover:bg-amber-50"
                    }`}
                  >
                    {detailRow.banned ? "解封用户" : "封禁用户"}
                  </button>
                  {detailRow.lastIp && (
                    <button
                      disabled={busy}
                      onClick={() => banRowIp(detailRow.lastIp as string)}
                      className="rounded-md border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    >
                      封禁此 IP
                    </button>
                  )}
                </div>
              </div>
            )}

            {detailRow && (
              <div className="mb-5 rounded-xl border border-border bg-secondary/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">管理备注</span>
                  <span className="text-xs text-muted-foreground">
                    仅管理员可见
                  </span>
                </div>
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value.slice(0, 1000))}
                  placeholder="为该用户添加内部备注（如：VIP、已退款、可疑账号…）"
                  rows={3}
                  className="w-full resize-y rounded-lg border border-border bg-card p-2.5 text-sm outline-none focus:border-primary"
                />
                <div className="mt-2 flex items-center gap-2">
                  <span className="mr-auto text-xs text-muted-foreground">
                    {noteDraft.length}/1000
                  </span>
                  {detailRow.note && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        setNoteDraft("");
                        void userAction({
                          action: "note",
                          email: detailRow.email,
                          note: "",
                        });
                      }}
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-50"
                    >
                      清空
                    </button>
                  )}
                  <button
                    disabled={busy || noteDraft === (detailRow.note ?? "")}
                    onClick={() =>
                      void userAction({
                        action: "note",
                        email: detailRow.email,
                        note: noteDraft,
                      })
                    }
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    保存备注
                  </button>
                </div>
              </div>
            )}

            {detailLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载中…
              </div>
            ) : detail ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    {
                      label: "剩余积分",
                      value: detail.user
                        ? detail.user.creditsTotal - detail.user.creditsUsed
                        : 0,
                    },
                    {
                      label: "累计消耗",
                      value: detail.ledger
                        .filter((l) => l.delta < 0 && l.kind !== "expire")
                        .reduce((s, l) => s - l.delta, 0),
                    },
                    { label: "作品数", value: detail.artworks.length },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-xl border border-border bg-secondary/40 p-3"
                    >
                      <p className="text-xs text-muted-foreground">
                        {s.label}
                      </p>
                      <p className="mt-1 text-lg font-bold">{s.value}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold">
                    生成作品（{detail.artworks.length} 张 ·{" "}
                    {memberBatches.length} 次生成）
                  </h4>
                  {detail.artworks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      该会员还没有作品。
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {memberBatches.map((batch, bi) => (
                        <div
                          key={batch[0].id}
                          className="rounded-lg border border-border p-2"
                        >
                          {/* 头部:跟前端进画布规则一致 —— 套图/多图批次或多节点血缘 → 点标题进
                              只读画布(看血缘+每张提示词);单张一次性图 → 点标题只看大图,不进画布。 */}
                          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                            {batchEntersCanvas(batch) ? (
                              <a
                                href={`/canvas?email=${encodeURIComponent(
                                  detailRow?.email ?? ""
                                )}&node=${encodeURIComponent(batch[0].id)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-0 flex-1 truncate text-muted-foreground transition-colors hover:text-primary hover:underline"
                                title={`${batch[0].prompt}\n点击进入作品页(创作画布·只读)`}
                              >
                                第 {memberBatches.length - bi} 批 ·{" "}
                                {batch[0].title}
                              </a>
                            ) : (
                              <a
                                href={artworkToolHref(batch[0])}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-0 flex-1 truncate text-muted-foreground transition-colors hover:text-primary hover:underline"
                                title={`${batch[0].prompt}\n点击进入对应功能页(生图/抠图/融图)`}
                              >
                                第 {memberBatches.length - bi} 批 ·{" "}
                                {batch[0].title}
                              </a>
                            )}
                            <span className="shrink-0 font-medium text-primary">
                              共 {batch.length} 张
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                            {batch.map((a) => (
                              /* 点图 → 直接大图查看(ImageLightbox) */
                              <button
                                key={a.id}
                                type="button"
                                onClick={() =>
                                  setLightbox({ src: a.image, alt: a.title })
                                }
                                className="block overflow-hidden rounded-md border border-border transition-all hover:-translate-y-0.5 hover:border-primary/50"
                                title="点击查看大图"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={cdnUrl(a.image)}
                                  alt={a.title}
                                  loading="lazy"
                                  className="aspect-square w-full bg-secondary object-cover"
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold">
                    积分消耗明细（{detail.ledger.length}）
                  </h4>
                  {detail.ledger.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      暂无积分流水。
                    </p>
                  ) : (
                    <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                      {detail.ledger.map((l) => (
                        <li
                          key={l.id}
                          className="flex items-center justify-between px-3 py-2 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {l.reason}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(l.createdAt).toLocaleString("zh-CN")}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 font-semibold ${
                              l.delta >= 0
                                ? "text-emerald-600"
                                : "text-red-600"
                            }`}
                          >
                            {l.delta >= 0 ? "+" : ""}
                            {l.delta}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {lightbox && (
        <ImageLightbox
          src={cdnUrl(lightbox.src)}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
