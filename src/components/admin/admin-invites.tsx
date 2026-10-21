"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authHeader } from "@/lib/supabase";

// 站长后台「邀请奖励」:开关 + 奖励数字 + 每月上限 + 默认推广语;下方邀请记录总表(可撤销作弊的邀请)。
type Config = {
  enabled: boolean;
  inviteeBonus: number;
  inviterSignup: number;
  inviterRecharge: number;
  monthlyCap: number;
  defaultSlogan: string;
};
type Row = {
  invitee: string;
  inviter: string;
  code: string;
  ip: string;
  inviteeReward: number;
  inviterReward: number;
  recharged: boolean;
  note: string;
  revoked: boolean;
  createdAt: string;
};

const NUM_FIELDS: { key: keyof Config; label: string; hint: string }[] = [
  { key: "inviteeBonus", label: "被邀请人注册奖励", hint: "好友通过邀请注册时,好友获得(在新人赠送之外另加),30 天有效" },
  { key: "inviterSignup", label: "邀请人 · 好友注册奖励", hint: "好友注册成功时,邀请人获得,1 年有效" },
  { key: "inviterRecharge", label: "邀请人 · 好友首充奖励", hint: "好友第一次在线充值成功时,邀请人再获得(兑换码不算),1 年有效" },
  { key: "monthlyCap", label: "每人每月最多奖励人数", hint: "每个邀请人每月最多拿多少个好友的奖励,0 = 不限" },
];

export function AdminInvites() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (query = "") => {
    const r = await fetch(`/api/admin/invites?q=${encodeURIComponent(query)}`, { headers: await authHeader() });
    const d = await r.json();
    if (r.ok) {
      setCfg(d.config);
      setRows(d.invites ?? []);
    } else setMsg({ ok: false, text: d.error || "加载失败" });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "config", config: cfg }),
      });
      const d = await r.json();
      if (r.ok) {
        setCfg(d.config);
        setMsg({ ok: true, text: "邀请奖励设置已保存" });
      } else setMsg({ ok: false, text: d.error || "保存失败" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(row: Row) {
    if (!confirm(`撤销 ${row.invitee} 的邀请关系?将扣回邀请人 ${row.inviter} 已获得的 ${row.inviterReward} 积分。`)) return;
    const r = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke", invitee: row.invitee }),
    });
    const d = await r.json();
    setMsg(r.ok ? { ok: true, text: `已撤销,扣回 ${d.deducted ?? 0} 积分` } : { ok: false, text: d.error || "撤销失败" });
    void load(q);
  }

  if (!cfg) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">邀请奖励</h2>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 card-shadow">
        <label className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
            className="h-4 w-4"
          />
          启用邀请有奖
          <span className="text-xs font-normal text-muted-foreground">
            (开启后用户头像菜单出现「邀请有奖」,注册页出现「邀请码」输入框)
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          {NUM_FIELDS.map((f) => (
            <div key={f.key}>
              <div className="mb-1 text-sm font-medium">{f.label}</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={String(cfg[f.key])}
                  onChange={(e) => setCfg({ ...cfg, [f.key]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                  className="w-28 rounded-md border border-border px-3 py-2 text-sm"
                />
                <span className="text-sm text-muted-foreground">{f.key === "monthlyCap" ? "人" : "积分"}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <div className="mb-1 text-sm font-medium">默认推广语(选填)</div>
          <input
            value={cfg.defaultSlogan}
            maxLength={60}
            onChange={(e) => setCfg({ ...cfg, defaultSlogan: e.target.value })}
            placeholder="用户没自己改推广语时显示这句,留空用系统默认"
            className="w-full rounded-md border border-border px-3 py-2 text-sm"
          />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          防刷:同一 IP 24 小时内通过邀请注册多个账号,只绑定关系不发奖励;所有奖励从站点积分库存划拨,库存不足时不发。
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            保存设置
          </Button>
          {msg && <span className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span>}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card card-shadow">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <span className="text-sm font-semibold">邀请记录({rows.length})</span>
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void load(q)}
              placeholder="搜索邀请人 / 被邀请人 / 邀请码"
              className="w-60 rounded-md border border-border px-3 py-1.5 text-sm"
            />
            <Button variant="outline" size="sm" onClick={() => void load(q)}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 font-medium">时间</th>
                <th className="px-3 py-2.5 font-medium">邀请人</th>
                <th className="px-3 py-2.5 font-medium">被邀请人</th>
                <th className="px-3 py-2.5 font-medium">邀请码</th>
                <th className="px-3 py-2.5 font-medium">IP</th>
                <th className="px-3 py-2.5 font-medium">好友得</th>
                <th className="px-3 py-2.5 font-medium">邀请人得</th>
                <th className="px-3 py-2.5 font-medium">状态</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">
                    暂无邀请记录
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.invitee} className="border-b border-border last:border-0">
                  <td className="px-5 py-2.5 text-muted-foreground">{new Date(r.createdAt).toLocaleString("zh-CN")}</td>
                  <td className="px-3 py-2.5">{r.inviter}</td>
                  <td className="px-3 py-2.5">{r.invitee}</td>
                  <td className="px-3 py-2.5 font-mono">{r.code}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.ip}</td>
                  <td className="px-3 py-2.5">{r.inviteeReward}</td>
                  <td className="px-3 py-2.5">{r.inviterReward}</td>
                  <td className="px-3 py-2.5">
                    {r.revoked ? (
                      <span className="text-muted-foreground">已撤销</span>
                    ) : r.note ? (
                      <span className="text-amber-600" title={r.note}>
                        可疑·未发奖
                      </span>
                    ) : r.recharged ? (
                      <span className="text-emerald-600">已首充</span>
                    ) : (
                      "已注册"
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {!r.revoked && (
                      <button type="button" onClick={() => void revoke(r)} className="text-xs text-red-600 hover:underline">
                        撤销
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
