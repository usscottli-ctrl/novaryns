"use client";

import * as React from "react";
import { Loader2, RefreshCw, Play, Pause, Trash2, RotateCw, ExternalLink, Globe } from "lucide-react";
import { useToast } from "@/components/ui/toast";

type Tenant = {
  subdomain: string; email: string; status: string; url: string | null;
  error: string | null; expiresAt: string | null; createdAt: string;
  provisionedAt: string | null; renewals: number; orderId: string;
  customDomains: string[];
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  suspended: "bg-amber-100 text-amber-700",
  provisioning: "bg-blue-100 text-blue-700",
  pending: "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
  purged: "bg-neutral-200 text-neutral-600",
};
const STATUS_LABEL: Record<string, string> = {
  active: "运行中", suspended: "已挂起", provisioning: "开通中",
  pending: "待开通", failed: "失败", purged: "已销毁",
};

function fmtDate(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysLeft(s: string | null): number | null {
  if (!s) return null;
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000);
}

// 后台「云端租户」管理面板(M4)。列出所有云端租户 + 挂起/恢复/销毁/重试。
export function AdminCloudTenants({ token }: { token: string | null }) {
  const { toast } = useToast();
  const [tenants, setTenants] = React.useState<Tenant[] | null>(null);
  const [busy, setBusy] = React.useState<string>(""); // "<sub>:<action>"

  const headers = React.useMemo<Record<string, string>>(
    () => {
      const h: Record<string, string> = {};
      if (token) h.Authorization = `Bearer ${token}`;
      return h;
    },
    [token]
  );

  const load = React.useCallback(async () => {
    try {
      const r = await fetch("/api/admin/cloud-tenants", { headers, cache: "no-store" });
      const d = await r.json();
      if (!r.ok) { toast(d.error || "加载失败", "error"); return; }
      setTenants(d.tenants || []);
    } catch { toast("加载失败", "error"); }
  }, [headers, toast]);

  React.useEffect(() => { load(); }, [load]);

  async function act(sub: string, action: "suspend" | "resume" | "purge" | "retry" | "set-domain", domain?: string) {
    const labels: Record<string, string> = { suspend: "挂起", resume: "恢复", purge: "销毁", retry: "重试开通", "set-domain": "域名设置" };
    if (action === "purge" && !window.confirm(`确定彻底销毁 ${sub}.starzeco.com?此操作不可逆(删实例/数据/算力)。`)) return;
    setBusy(`${sub}:${action}`);
    try {
      const r = await fetch("/api/admin/cloud-tenants", {
        method: "POST", headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ subdomain: sub, action, domain }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) toast(d.error || `${labels[action]}失败`, "error");
      else {
        const warns = (d.warnings || []) as string[];
        toast(warns.length ? `已保存,但:${warns.join(";")}` : `${labels[action]}成功`, warns.length ? "info" : "success");
        await load();
      }
    } catch { toast("操作失败", "error"); }
    finally { setBusy(""); }
  }

  // 绑定/解绑自定义域名(v1 单个)。CN 需已 ICP 备案且 DNS 指向本机。
  function setDomain(t: Tenant) {
    const cur = t.customDomains[0] || "";
    const input = window.prompt(
      `为 ${t.subdomain}.starzeco.com 绑定自定义域名(留空=解绑)。\n注意:大陆区域名须已 ICP 备案,并把 DNS 解析到本站服务器,证书才会自动签发。`,
      cur
    );
    if (input === null) return; // 取消
    act(t.subdomain, "set-domain", input.trim());
  }

  if (tenants === null) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载中…</div>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">云端租户</h2>
          <p className="text-sm text-muted-foreground">付款后自动开通的专属实例 · 共 {tenants.length} 个</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-secondary">
          <RefreshCw className="h-3.5 w-3.5" />刷新
        </button>
      </div>

      {tenants.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          暂无云端租户。买家在购买站付款后会自动出现在这里。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">实例</th>
                <th className="px-3 py-2 font-medium">买家</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">到期</th>
                <th className="px-3 py-2 font-medium">续费</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const dl = daysLeft(t.expiresAt);
                const b = (a: string) => busy === `${t.subdomain}:${a}`;
                const anyBusy = busy.startsWith(`${t.subdomain}:`);
                return (
                  <tr key={t.orderId} className="border-t border-border">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 font-medium">
                        {t.subdomain}.starzeco.com
                        {t.url && t.status === "active" && (
                          <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-primary"><ExternalLink className="h-3.5 w-3.5" /></a>
                        )}
                      </div>
                      {t.customDomains.length > 0 && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Globe className="h-3 w-3" />{t.customDomains.join(", ")}
                        </div>
                      )}
                      {t.error && <div className="mt-0.5 text-xs text-red-600">{t.error}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{t.email}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status] || "bg-neutral-100 text-neutral-600"}`}>
                        {STATUS_LABEL[t.status] || t.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {fmtDate(t.expiresAt)}
                      {dl !== null && t.status !== "purged" && (
                        <span className={`ml-1 text-xs ${dl < 0 ? "text-red-600" : dl < 15 ? "text-amber-600" : "text-muted-foreground"}`}>
                          {dl < 0 ? `已过期 ${-dl}天` : `剩 ${dl}天`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{t.renewals > 0 ? `${t.renewals} 次` : "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {t.status === "active" && (
                          <ActBtn onClick={() => setDomain(t)} busy={b("set-domain")} disabled={anyBusy} icon={Globe} title="域名" />
                        )}
                        {t.status === "active" && (
                          <ActBtn onClick={() => act(t.subdomain, "suspend")} busy={b("suspend")} disabled={anyBusy} icon={Pause} title="挂起" />
                        )}
                        {t.status === "suspended" && (
                          <ActBtn onClick={() => act(t.subdomain, "resume")} busy={b("resume")} disabled={anyBusy} icon={Play} title="恢复" />
                        )}
                        {t.status === "failed" && (
                          <ActBtn onClick={() => act(t.subdomain, "retry")} busy={b("retry")} disabled={anyBusy} icon={RotateCw} title="重试开通" />
                        )}
                        {t.status !== "purged" && (
                          <ActBtn onClick={() => act(t.subdomain, "purge")} busy={b("purge")} disabled={anyBusy} icon={Trash2} title="销毁" danger />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        到期自动挂起由 CN 服务器每日 cron 调 <code>/api/cloud/lifecycle</code> 驱动;续费(买家再次付款同一子域名)自动延期并恢复。
      </p>
    </div>
  );
}

function ActBtn({ onClick, busy, disabled, icon: Icon, title, danger }: {
  onClick: () => void; busy: boolean; disabled: boolean;
  icon: React.ComponentType<{ className?: string }>; title: string; danger?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title}
      className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors disabled:opacity-40 ${
        danger ? "border-red-200 text-red-600 hover:bg-red-50" : "border-border text-foreground hover:bg-secondary"
      }`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {title}
    </button>
  );
}
