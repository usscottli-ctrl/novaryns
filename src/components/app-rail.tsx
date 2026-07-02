"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Home,
  Sparkles,
  LayoutGrid,
  Image as ImageIcon,
  Workflow,
  Gem,
  Gift,
  Sun,
  Moon,
  Settings,
  LogOut,
  ChevronRight,
  ChevronDown,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/locale-context";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useRecharge } from "@/lib/recharge-modal-context";
import { usePaymentConfig } from "@/lib/payment-context";
import { browserSupabase } from "@/lib/supabase";
import { BRAND, BRAND_SQUARE_LOGO } from "@/lib/brand";
import { displayEmail } from "@/lib/account-identity";
import { menuCategories, TOOL_COUNT_LABEL } from "@/lib/tool-meta";

type Item = { href: string; label: { zh: string; en: string }; Icon: typeof Home };

// 顶栏导航(桌面,设计稿顺序):首页 / 工作台 / 创作▾ / 模板 / 作品 / 画布。
// 创作下拉插在「工作台」与「模板」之间。底部 Tab(移动):首页 / 画布 / 创作FAB / 作品 / 我的。
const NAV_BEFORE: Item[] = [
  { href: "/", label: { zh: "首页", en: "Home" }, Icon: Home },
  { href: "/dashboard", label: { zh: "工作台", en: "Workspace" }, Icon: ImageIcon },
];
const NAV_AFTER: Item[] = [
  { href: "/templates", label: { zh: "模板", en: "Templates" }, Icon: LayoutGrid },
  { href: "/works", label: { zh: "作品", en: "Works" }, Icon: ImageIcon },
  { href: "/canvas", label: { zh: "画布", en: "Canvas" }, Icon: Workflow },
];

// 创作 mega 下拉分组(单一事实源 tool-meta,curated 3/4/4/5)。
const MENU_CATS = menuCategories();
// 下拉排两列,每列内两个分组「紧凑堆叠」且两列等高:
// 左列=生成创作(3)+图像处理(5)=8;右列=服装电商(4)+营销工具(4)=8。各 8 项+2 标题,齐平。
const MENU_COLS = [
  [MENU_CATS[0], MENU_CATS[1]],
  [MENU_CATS[2], MENU_CATS[3]],
].map((col) => col.filter(Boolean));

export function AppRail() {
  const { t, locale } = useI18n();
  const L = (zh: string, en: string) => (locale === "en" ? en : zh);
  const path = usePathname();
  const { user, remaining, signOut } = useAuth();
  const { openAuth } = useAuthModal();
  const { openRecharge } = useRecharge();
  const { rechargeEnabled, pro } = usePaymentConfig();
  const [acct, setAcct] = useState(false);
  // 头像菜单:桌面悬停打开,离开延迟关闭(留时间让鼠标移到菜单上)。
  const acctTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dark, setDark] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAcct(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  // 路由变化关掉账户菜单。
  useEffect(() => {
    setAcct(false);
  }, [path]);

  // 管理员检测(共用 sessionStorage 缓存,5min TTL)。
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    try {
      const raw = sessionStorage.getItem("novaryns:adminVerifiedV1");
      if (raw) {
        const c = JSON.parse(raw) as { email: string; ts: number };
        if (c.email === user.email && Date.now() - c.ts <= 5 * 60 * 1000) {
          setIsAdmin(true);
        }
      }
    } catch {
      /* ignore */
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await browserSupabase().auth.getSession();
        const tok = data.session?.access_token;
        if (!tok) return;
        const res = await fetch("/api/admin/settings", {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (cancelled) return;
        setIsAdmin(res.ok);
        try {
          if (res.ok) {
            sessionStorage.setItem(
              "novaryns:adminVerifiedV1",
              JSON.stringify({ email: user.email, ts: Date.now() })
            );
          } else {
            sessionStorage.removeItem("novaryns:adminVerifiedV1");
          }
        } catch {
          /* ignore */
        }
      } catch {
        /* 非管理员/无会话 → 隐藏 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const toggleTheme = () => {
    const d = document.documentElement.classList.toggle("dark");
    setDark(d);
    try {
      localStorage.setItem("theme", d ? "dark" : "light");
    } catch {}
  };
  const isActive = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);
  const onCanvas = (path || "").startsWith("/canvas");
  const initial = user?.name?.trim().charAt(0).toUpperCase() || "U";

  // ── 桌面顶栏链接(纯文字;hover/激活=圆角药丸底色变深,文字不变色不出蓝条) ──
  const TopLink = ({ href, label }: Item) => {
    const active = isActive(href);
    return (
      <Link href={href} className="group/nav flex h-[60px] items-center px-1.5">
        <span
          className={cn(
            "rounded-[10px] px-3 py-1.5 text-[14px] transition-colors",
            active
              ? "bg-c-subtle font-semibold text-c-text"
              : "font-medium text-c-text2 group-hover/nav:bg-c-subtle group-hover/nav:text-c-text"
          )}
        >
          {L(label.zh, label.en)}
        </span>
      </Link>
    );
  };

  // ── 移动底栏 Tab ──
  const TabLink = ({
    href,
    labelKey,
    label,
    Icon,
  }: {
    href: string;
    labelKey?: string;
    label?: { zh: string; en: string };
    Icon: typeof Home;
  }) => (
    <Link
      href={href}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-colors",
        isActive(href) ? "text-primary" : "text-muted-foreground"
      )}
    >
      <Icon className="h-[20px] w-[20px]" strokeWidth={2} />
      <span>{label ? L(label.zh, label.en) : t(labelKey ?? "")}</span>
    </Link>
  );

  // 账户弹出菜单(顶栏右上 / 移动「我的」共用,浅色 token 自适应)。
  const AccountMenu = ({ className }: { className?: string }) =>
    user && acct ? (
      <div
        className={cn(
          "absolute z-50 w-[230px] rounded-2xl border border-border bg-card p-1.5 shadow-[var(--shadow-pop)]",
          className
        )}
      >
        <div className="mb-1 flex items-center gap-2.5 border-b border-border px-2.5 pb-2.5 pt-1.5">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-bold text-white [background:var(--grad-acc)]">
            {initial}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-foreground">
              {displayEmail(user.email) || user.name}
            </div>
            <div className="text-[11px] text-muted-foreground">
              💎 {remaining} {t("nav.credits")}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[13px] text-foreground hover:bg-secondary"
        >
          <span className="flex items-center gap-2">
            {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {t("nav.theme")}
          </span>
          <span className="text-[12px] text-muted-foreground">
            {dark ? t("nav.themeDark") : t("nav.themeLight")}
          </span>
        </button>
        <Link
          href="/account?tab=credits"
          onClick={() => setAcct(false)}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[13px] text-foreground hover:bg-secondary"
        >
          <span className="flex items-center gap-2">
            <Gem className="h-4 w-4" />
            {t("nav.credits")}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </Link>
        {pro && (
          <button
            type="button"
            onClick={() => {
              setAcct(false);
              openRecharge("code");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-foreground hover:bg-secondary"
          >
            <Gift className="h-4 w-4" />
            {L("兑换码", "Redeem code")}
          </button>
        )}
        <Link
          href="/account/security"
          onClick={() => setAcct(false)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-foreground hover:bg-secondary"
        >
          <Settings className="h-4 w-4" />
          {t("menu.security")}
        </Link>
        {isAdmin && (
          <Link
            href="/admin"
            onClick={() => setAcct(false)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-foreground hover:bg-secondary"
          >
            <ShieldCheck className="h-4 w-4" />
            {t("menu.admin")}
          </Link>
        )}
        <div className="my-1 h-px bg-border" />
        <button
          type="button"
          onClick={() => {
            setAcct(false);
            signOut();
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-[#E5484D] hover:bg-secondary"
        >
          <LogOut className="h-4 w-4" />
          {t("nav.signOut")}
        </button>
      </div>
    ) : null;

  return (
    <div ref={ref}>
      {/* ───────── 桌面顶栏 ───────── */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-40 hidden h-[60px] border-b border-c-border bg-card/95 backdrop-blur transition-transform duration-300 ease-out md:block",
          onCanvas && "-translate-y-full"
        )}
      >
        {/* 内容走和页面一致的居中容器,保证导航与下方内容左右对齐 */}
        <div className="flex h-full w-full items-center gap-1 px-5 sm:px-6 lg:px-8">
        {/* 品牌 */}
        <Link href="/" title={BRAND} className="mr-2 flex items-center gap-2">
          <span
            className={cn(
              "flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-[9px]",
              !BRAND_SQUARE_LOGO.includes("starzeco") && "[background:var(--grad-acc)]"
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={BRAND_SQUARE_LOGO}
              alt={BRAND}
              className="h-8 w-8 rounded-[9px] object-contain"
            />
          </span>
          <span className="text-[15px] font-bold tracking-tight">{BRAND}</span>
        </Link>

        {/* 导航(设计顺序:首页 / 工作台 / 创作▾ / 模板 / 作品 / 画布) */}
        <nav className="flex items-center gap-0.5">
          {NAV_BEFORE.map((it) => (
            <TopLink key={it.href} {...it} />
          ))}
          {/* 创作:hover 出 mega 下拉;点击进创作中心 /tools(不再弹左侧抽屉)。 */}
          <div className="group/create relative">
            <Link
              href="/tools"
              onClick={() => setAcct(false)}
              className="group/nav flex h-[60px] items-center px-1.5"
            >
              <span
                className={cn(
                  "flex items-center gap-1 rounded-[10px] px-3 py-1.5 text-[14px] transition-colors",
                  (path || "").startsWith("/tools")
                    ? "bg-c-subtle font-semibold text-c-text"
                    : "font-medium text-c-text2 group-hover/nav:bg-c-subtle group-hover/nav:text-c-text"
                )}
              >
                {t("nav.create")}
                <ChevronDown className="h-3.5 w-3.5 opacity-60 transition-transform group-hover/create:rotate-180" />
              </span>
            </Link>
            {/* mega 下拉(spec B.9):宽 392,grid-2,分组彩点 + 纯文字工具 + 页脚 */}
            <div className="nv-menu-down invisible absolute left-0 top-[calc(100%+6px)] z-50 w-[300px] rounded-[16px] border border-c-border bg-c-card p-3 opacity-0 shadow-pop transition-all duration-150 group-hover/create:visible group-hover/create:opacity-100">
              <div className="flex gap-x-2">
                {MENU_COLS.map((col, ci) => (
                  <div key={ci} className="flex-1 space-y-4">
                    {col.map((g) => (
                      <div key={g.name}>
                        <p className="mb-1 flex items-center gap-2 px-2 text-[11.5px] font-semibold text-c-text3">
                          <span
                            className="h-1.5 w-1.5 flex-none rounded-full"
                            style={{ background: g.dot }}
                          />
                          {L(g.name, g.en)}
                        </p>
                        {g.tools.map((tool) => (
                          <Link
                            key={tool.slug}
                            href={tool.live === false ? "/tools" : tool.href}
                            className="block rounded-[10px] px-2 py-1.5 text-[13px] font-medium text-c-text transition-colors hover:bg-c-subtle"
                          >
                            {L(tool.key, tool.en)}
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {/* 页脚 */}
              <div className="mt-2 flex items-center justify-between border-t border-c-line px-2 pt-2.5">
                <span className="text-[11.5px] text-c-text3">
                  {L(`${TOOL_COUNT_LABEL} · 覆盖出图全流程`, "18 tools · full pipeline")}
                </span>
                <Link
                  href="/tools"
                  className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-acc transition-colors hover:underline"
                >
                  {L("查看全部工具", "All tools")}
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
          {NAV_AFTER.map((it) => (
            <TopLink key={it.href} {...it} />
          ))}
        </nav>

        <div className="flex-1" />

        {/* 右侧:主题 / 积分 / 头像 */}
        <button
          type="button"
          onClick={toggleTheme}
          title={t("nav.theme")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {dark ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
        </button>
        {user && (
          <Link
            href="/account?tab=credits"
            className="flex items-center gap-1.5 rounded-[10px] border border-c-border2 px-3 py-1.5 text-[13px] font-semibold text-c-text transition-colors hover:bg-c-subtle"
          >
            <Gem className="h-4 w-4 text-acc" />
            <span className="tabular-nums">{remaining}</span>
          </Link>
        )}
        {user && rechargeEnabled && (
          <button
            type="button"
            onClick={() => {
              setAcct(false);
              openRecharge("pay");
            }}
            className="rounded-[10px] bg-acc-tint px-3 py-1.5 text-[13px] font-semibold text-acc transition-colors hover:brightness-95"
          >
            {L("充值", "Top up")}
          </button>
        )}
        {/* Pro 站点未开在线充值时(海外站/收款未配)仍提供「兑换码」入口;开源版隐藏 */}
        {user && pro && !rechargeEnabled && (
          <button
            type="button"
            onClick={() => {
              setAcct(false);
              openRecharge("code");
            }}
            className="rounded-[10px] bg-acc-tint px-3 py-1.5 text-[13px] font-semibold text-acc transition-colors hover:brightness-95"
          >
            {L("兑换码", "Redeem")}
          </button>
        )}
        <div
          className="relative"
          onMouseEnter={() => {
            if (acctTimer.current) clearTimeout(acctTimer.current);
            if (user) setAcct(true);
          }}
          onMouseLeave={() => {
            acctTimer.current = setTimeout(() => setAcct(false), 160);
          }}
        >
          <button
            type="button"
            onClick={() => (user ? setAcct((v) => !v) : openAuth())}
            className="flex h-9 items-center gap-1.5 rounded-full pl-1 pr-2 transition-colors hover:bg-secondary"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold text-white [background:var(--grad-acc)]">
              {user ? initial : <UserIcon className="h-4 w-4" />}
            </span>
          </button>
          <AccountMenu className="right-0 top-11" />
        </div>
        </div>
      </header>

      {/* ───────── 移动底栏 Tab ───────── */}
      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex h-[58px] items-stretch border-t border-border bg-card/95 backdrop-blur transition-transform duration-300 ease-out md:hidden",
          onCanvas && "translate-y-full"
        )}
      >
        <TabLink href="/" labelKey="nav.home" Icon={Home} />
        <TabLink href="/templates" label={{ zh: "模板", en: "Templates" }} Icon={LayoutGrid} />
        {/* 中间凸起「创作」FAB → 创作中心 /tools */}
        <Link
          href="/tools"
          onClick={() => setAcct(false)}
          className="flex flex-1 flex-col items-center justify-center"
        >
          <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-[var(--shadow-btn)] [background:var(--grad-acc)]">
            <Sparkles className="h-6 w-6" strokeWidth={2} />
          </span>
        </Link>
        <TabLink href="/works" label={{ zh: "作品", en: "Works" }} Icon={ImageIcon} />
        <button
          type="button"
          onClick={() => (user ? setAcct((v) => !v) : openAuth())}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-colors",
            acct ? "text-primary" : "text-muted-foreground"
          )}
        >
          <UserIcon className="h-[20px] w-[20px]" strokeWidth={2} />
          <span>{t("nav.account")}</span>
        </button>
        <AccountMenu className="bottom-[64px] right-2" />
      </nav>
    </div>
  );
}
