"use client";

import { useEffect, useState } from "react";
import { Copy, Gift, Link2, Loader2, UserPlus, Users, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useBrand } from "@/lib/brand-context";
import { authHeader } from "@/lib/supabase";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// 推广中心(邀请有奖,2026-10-21):专属链接 + 邀请码 + 推广语 + 奖励说明 + 邀请记录。
// 参考同行推广中心,按客户要求去掉了「我的上级邀请人」和「月度梯度/邀请进度」。

type Overview = {
  code: string;
  slogan: string;
  rules: { inviteeBonus: number; inviterSignup: number; inviterRecharge: number };
  invited: number;
  effective: number;
  earned: number;
  records: { who: string; at: string; recharged: boolean; reward: number; revoked: boolean }[];
};

const card = "rounded-card border border-c-border bg-c-card p-5 shadow-card";

export function InviteClient() {
  const { user, ready } = useAuth();
  const { openAuth } = useAuthModal();
  const { name: brandName } = useBrand();
  const { toast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slogan, setSlogan] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      openAuth("sign-in");
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/invite", { headers: await authHeader(), cache: "no-store" });
        const d = await r.json();
        if (!alive) return;
        if (!r.ok) {
          setError(d.error || "加载失败,请稍后重试");
          return;
        }
        setData(d);
        setSlogan(d.slogan || `我在用${brandName}做电商图,一键出整套主图和详情页,注册就送积分!`);
      } catch {
        if (alive) setError("加载失败,请稍后重试");
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, user, openAuth, brandName]);

  const link = data && typeof window !== "undefined" ? `${window.location.origin}/?invite=${data.code}` : "";

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what}已复制`, "success");
    } catch {
      toast("复制失败,请手动选择复制", "error");
    }
  }

  async function saveSlogan() {
    setSaving(true);
    try {
      const r = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ slogan }),
      });
      toast(r.ok ? "推广语已保存" : "保存失败,请重试", r.ok ? "success" : "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-7 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-c-text">邀请有奖</h1>
          <p className="mt-1 text-[13.5px] text-c-text3">邀请好友注册使用,积分奖励自动到账</p>
        </div>
        {data && (
          <button
            type="button"
            onClick={() => copy(`${slogan} ${link}`.trim(), "邀请链接")}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-acc px-4 py-2 text-[13.5px] font-semibold text-white hover:brightness-95"
          >
            <Copy className="h-4 w-4" /> 复制邀请链接
          </button>
        )}
      </div>

      {error ? (
        <div className={cn(card, "text-center text-[14px] text-c-text3")}>{error}</div>
      ) : !data ? (
        <div className={cn(card, "flex items-center justify-center gap-2 text-c-text3")}>
          <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
        </div>
      ) : (
        <div className="space-y-4">
          {/* 概览数字 */}
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: Users, label: "已邀请好友", value: data.invited, unit: "人", hint: "通过你的链接或邀请码注册" },
              { icon: CheckCircle2, label: "已生效", value: data.effective, unit: "人", hint: "好友已完成首次充值" },
              { icon: Gift, label: "累计获得奖励", value: data.earned, unit: "积分", hint: "奖励积分已自动到账" },
            ].map((m) => (
              <div key={m.label} className={card}>
                <div className="flex items-center justify-between text-[13px] text-c-text3">
                  {m.label}
                  <m.icon className="h-4 w-4" />
                </div>
                <div className="mt-2 text-[28px] font-bold text-c-text">
                  {m.value} <span className="text-[13px] font-normal text-c-text3">{m.unit}</span>
                </div>
                <p className="mt-1 text-[12px] text-c-text3">{m.hint}</p>
              </div>
            ))}
          </div>

          {/* 链接 + 邀请码 + 推广语 */}
          <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
            <div className={card}>
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-c-text2">
                <Link2 className="h-4 w-4" /> 专属邀请链接
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={link}
                  className="h-10 min-w-0 flex-1 rounded-[10px] border border-c-border2 bg-c-subtle2 px-3 text-[13px] text-c-text"
                />
                <button
                  type="button"
                  onClick={() => copy(link, "邀请链接")}
                  className="shrink-0 rounded-[10px] bg-c-text px-4 text-[13px] font-medium text-c-card hover:opacity-90"
                >
                  复制
                </button>
              </div>
              <p className="mt-2 text-[12px] text-c-text3">好友从这个链接进入并注册后,自动绑定邀请关系(30 天内有效)。</p>

              <p className="mb-2 mt-5 text-[13px] font-medium text-c-text2">我的邀请码</p>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[24px] font-bold tracking-[0.2em] text-c-text">{data.code}</span>
                <button
                  type="button"
                  onClick={() => copy(data.code, "邀请码")}
                  className="rounded-[10px] border border-c-border2 px-3 py-1.5 text-[12.5px] text-c-text2 hover:bg-c-subtle2"
                >
                  复制
                </button>
              </div>
              <p className="mt-2 text-[12px] text-c-text3">好友注册时在「邀请码」里填写,效果和点链接一样。</p>
            </div>

            <div className={card}>
              <div className="mb-2 flex items-center justify-between text-[13px] font-medium text-c-text2">
                分享推广语
                <span className="text-[12px] font-normal text-c-text3">{slogan.length} / 60</span>
              </div>
              <textarea
                rows={3}
                value={slogan}
                maxLength={60}
                onChange={(e) => setSlogan(e.target.value)}
                className="block w-full resize-none rounded-[10px] border border-c-border2 bg-c-subtle2 px-3 py-2 text-[13px] text-c-text focus:outline-none"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveSlogan()}
                  disabled={saving}
                  className="rounded-[10px] bg-c-text px-4 py-2 text-[13px] font-medium text-c-card hover:opacity-90 disabled:opacity-60"
                >
                  保存推广语
                </button>
                <button
                  type="button"
                  onClick={() => copy(`${slogan} ${link}`.trim(), "推广语和链接")}
                  className="rounded-[10px] border border-c-border2 px-4 py-2 text-[13px] text-c-text2 hover:bg-c-subtle2"
                >
                  连同链接一起复制
                </button>
              </div>
            </div>
          </div>

          {/* 奖励说明(数字来自后台设置) */}
          <div className={card}>
            <p className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold text-c-text">
              <UserPlus className="h-4 w-4" /> 奖励说明
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { when: "好友通过你的邀请注册", who: "好友获得", n: data.rules.inviteeBonus },
                { when: "好友注册成功", who: "你获得", n: data.rules.inviterSignup },
                { when: "好友首次充值", who: "你再获得", n: data.rules.inviterRecharge },
              ]
                .filter((r) => r.n > 0)
                .map((r, i) => (
                  <div key={r.when} className="rounded-[12px] bg-c-subtle2 p-4">
                    <p className="text-[12px] text-c-text3">
                      {i + 1}. {r.when}
                    </p>
                    <p className="mt-1 text-[15px] text-c-text">
                      {r.who} <span className="text-[22px] font-bold text-acc">{r.n}</span> 积分
                    </p>
                  </div>
                ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-c-text3">
              奖励积分自动到账,好友注册奖励 30 天内有效,你获得的邀请奖励 1 年内有效。同一设备/网络批量注册、虚假注册不计入奖励,
              活动奖励以实际到账记录为准。
            </p>
          </div>

          {/* 邀请记录 */}
          <div className={card}>
            <p className="mb-3 text-[14px] font-semibold text-c-text">邀请记录</p>
            {data.records.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-c-text3">还没有邀请记录,复制链接发给好友试试吧</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[460px] text-[13px]">
                  <thead>
                    <tr className="text-left text-[12px] text-c-text3">
                      <th className="pb-2 font-normal">好友</th>
                      <th className="pb-2 font-normal">注册时间</th>
                      <th className="pb-2 font-normal">状态</th>
                      <th className="pb-2 text-right font-normal">你获得</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((r) => (
                      <tr key={r.who + r.at} className="border-t border-c-border">
                        <td className="py-2.5 text-c-text">{r.who}</td>
                        <td className="py-2.5 text-c-text3">
                          {new Date(r.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="py-2.5">
                          {r.revoked ? (
                            <span className="text-c-text3">已失效</span>
                          ) : r.recharged ? (
                            <span className="text-[#16A34A]">已充值 · 已生效</span>
                          ) : (
                            <span className="text-c-text2">已注册</span>
                          )}
                        </td>
                        <td className="py-2.5 text-right font-medium text-c-text">{r.reward > 0 ? `+${r.reward}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
