"use client";

import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SUITE_PLATFORMS } from "@/lib/mock-data";

const PF_LABEL: Record<string, string> = Object.fromEntries(
  SUITE_PLATFORMS.map((p) => [p.id, p.label])
);

type StyleRow = { name: string; current: string; default: string; changed: boolean };
type View = {
  styles: StyleRow[];
  suiteSystem: { current: string; default: string; changed: boolean };
  suitePlatforms: { id: string; current: string; default: string; changed: boolean }[];
  notes: { generateDefault: string; ratio: string };
};

export function AdminPrompts() {
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [styleVals, setStyleVals] = useState<Record<string, string>>({});
  const [suiteVal, setSuiteVal] = useState("");
  const [platVals, setPlatVals] = useState<Record<string, string>>({});
  const [openDefault, setOpenDefault] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await browserSupabase().auth.getSession();
      const tok = data.session?.access_token ?? null;
      setToken(tok);
      if (!tok) return;
      const res = await fetch("/api/admin/prompts", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) applyView(await res.json());
    })();
  }, []);

  function applyView(v: View) {
    setView(v);
    const sv: Record<string, string> = {};
    v.styles.forEach((s) => (sv[s.name] = s.current));
    setStyleVals(sv);
    setSuiteVal(v.suiteSystem.current);
    const pv: Record<string, string> = {};
    v.suitePlatforms.forEach((x) => (pv[x.id] = x.current));
    setPlatVals(pv);
  }

  async function save() {
    if (!token) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/prompts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ styles: styleVals, suiteSystem: suiteVal, suitePlatforms: platVals }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "保存失败");
      applyView(await res.json());
      setMsg("已保存，立即生效");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (!token) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">提示词配置</h2>
        <p className="mt-2 text-sm text-muted-foreground">需要管理员登录后查看。</p>
      </section>
    );
  }
  if (!view) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">提示词配置</h2>
        <p className="mt-2 text-sm text-muted-foreground">加载中…</p>
      </section>
    );
  }

  const dirty =
    view.styles.some((s) => styleVals[s.name] !== s.current) ||
    suiteVal !== view.suiteSystem.current ||
    view.suitePlatforms.some((x) => platVals[x.id] !== x.current);

  return (
    <section className="space-y-6 rounded-2xl border border-border bg-card p-6">
      <div>
        <h2 className="text-lg font-semibold">提示词配置（程序在用户提示词之外附加的内容）</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          这里能看到/编辑程序自动加的提示词，保存后立即对线上生效。修改过的项会标「已改」，可一键恢复默认对照。
        </p>
      </div>

      {/* 透明说明 */}
      <div className="space-y-1 rounded-xl bg-secondary/40 p-4 text-xs text-muted-foreground">
        <p>· 生图页「默认」风格：{view.notes.generateDefault}</p>
        <p>· 生图页「比例」：{view.notes.ratio}</p>
      </div>

      {/* 生图页 各风格追加文案 */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">生图页 · 风格追加文案（选中对应风格时，追加到用户提示词后）</h3>
        {view.styles.map((s) => (
          <div key={s.name} className="rounded-xl border border-border p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {s.name}
                {styleVals[s.name] !== s.default && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    已改
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setOpenDefault((o) => ({ ...o, [s.name]: !o[s.name] }))
                  }
                >
                  {openDefault[s.name] ? "隐藏默认" : "看代码默认"}
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() =>
                    setStyleVals((v) => ({ ...v, [s.name]: s.default }))
                  }
                >
                  恢复默认
                </button>
              </div>
            </div>
            <Textarea
              value={styleVals[s.name] ?? ""}
              onChange={(e) =>
                setStyleVals((v) => ({ ...v, [s.name]: e.target.value }))
              }
              className="min-h-[60px] text-xs"
            />
            {openDefault[s.name] && (
              <p className="mt-2 whitespace-pre-wrap rounded bg-secondary/50 p-2 text-[11px] text-muted-foreground">
                代码默认：{s.default}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* 一键套图 system 指令 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            一键套图 · 规划指令（让 AI 规划 13 张套图的完整 system 提示词）
            {suiteVal !== view.suiteSystem.default && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                已改
              </span>
            )}
          </h3>
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => setSuiteVal(view.suiteSystem.default)}
          >
            恢复默认
          </button>
        </div>
        <Textarea
          value={suiteVal}
          onChange={(e) => setSuiteVal(e.target.value)}
          className="min-h-[180px] text-xs"
        />
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">看代码默认</summary>
          <p className="mt-1 whitespace-pre-wrap rounded bg-secondary/50 p-2">
            {view.suiteSystem.default}
          </p>
        </details>
      </div>

      {/* 一键套图 · 各平台风格覆盖段(选平台时追加在上面 system 之后) */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">
          一键套图 · 平台风格覆盖段（用户选对应平台时，追加在上面规划指令之后，覆盖风格与文案语言）
        </h3>
        <p className="text-xs text-muted-foreground">
          淘宝/天猫 = 默认（无覆盖，走上面的规划指令）；其余平台各一段，可编辑，留空=恢复默认。
        </p>
        {view.suitePlatforms.map((pf) => (
          <div key={pf.id} className="rounded-xl border border-border p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {PF_LABEL[pf.id] ?? pf.id}
                {platVals[pf.id] !== pf.default && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    已改
                  </span>
                )}
              </span>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => setPlatVals((v) => ({ ...v, [pf.id]: pf.default }))}
              >
                恢复默认
              </button>
            </div>
            <Textarea
              value={platVals[pf.id] ?? ""}
              onChange={(e) => setPlatVals((v) => ({ ...v, [pf.id]: e.target.value }))}
              className="min-h-[90px] text-xs"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={save} disabled={saving || !dirty} variant="gradient">
          {saving ? "保存中…" : "保存并生效"}
        </Button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
    </section>
  );
}
