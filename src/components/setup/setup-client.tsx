"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck, Sparkles, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/locale-context";

// 首启配置向导表单(单页)。
// - 未配置的自托管新实例才会渲染到这里(服务端 /setup 已做「已配置→跳首页」门控)。
// - 提交到 POST /api/setup(首启专用、自锁);写完即锁,已配置实例接口返回 403。
// - 中英双语按当前 locale 就地渲染(向导文案量小,不进字典)。

type Txt = {
  welcome: string;
  subtitle: string;
  finishHint: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiKeyHelp: string; // 含微信号,由 JSX 渲染加粗
  licenseLabel: string;
  licenseOptional: string;
  licensePlaceholder: string;
  licenseHelp: string;
  siteNameLabel: string;
  siteNameOptional: string;
  siteNamePlaceholder: string;
  siteNameHelp: string;
  secureNote: string;
  submit: string;
  submitting: string;
  needApiKey: string;
  saved: string;
  savedHint: string;
  genericError: string;
};

const ZH: Txt = {
  welcome: "欢迎使用",
  subtitle: "只需填几项,配置完成即可开始使用。",
  finishHint: "以下配置会安全地保存到你的实例,无需改代码或环境变量。",
  apiKeyLabel: "OpenAI API Key",
  apiKeyPlaceholder: "粘贴你的 sk-... ",
  apiKeyHelp: "不知道 API Key 怎么获取?可联系作者微信 xingze063,或付费由作者代为提供 / 配置。",
  licenseLabel: "License Key",
  licenseOptional: "选填 · Pro 授权",
  licensePlaceholder: "NOVA-XXXX-XXXX-XXXX-XXXX",
  licenseHelp: "填入后可解锁 Pro 功能(白标 / 收银 / 多用户 / 后台高阶)。没有可留空。",
  siteNameLabel: "站点名称",
  siteNameOptional: "选填",
  siteNamePlaceholder: "例如:我的商图工作台",
  siteNameHelp: "用于后续白标展示,可稍后再改。",
  secureNote: "API Key 经加密安全存储,不会明文外泄。",
  submit: "保存并开始使用",
  submitting: "正在保存…",
  needApiKey: "请填写有效的 OpenAI API Key",
  saved: "配置完成!",
  savedHint: "正在进入…",
  genericError: "保存失败,请稍后重试",
};

const EN: Txt = {
  welcome: "Welcome to",
  subtitle: "Fill in a few fields and you're ready to go.",
  finishHint:
    "These settings are stored securely on your instance — no code or env changes needed.",
  apiKeyLabel: "OpenAI API Key",
  apiKeyPlaceholder: "Paste your sk-...",
  apiKeyHelp:
    "Not sure how to get an API Key? Contact the author on WeChat xingze063, or pay the author to provide/configure one.",
  licenseLabel: "License Key",
  licenseOptional: "Optional · Pro license",
  licensePlaceholder: "NOVA-XXXX-XXXX-XXXX-XXXX",
  licenseHelp:
    "Enter to unlock Pro features (white-label / billing / multi-user / advanced admin). Leave blank if you don't have one.",
  siteNameLabel: "Site name",
  siteNameOptional: "Optional",
  siteNamePlaceholder: "e.g. My Product Studio",
  siteNameHelp: "Used for white-labeling later. You can change it anytime.",
  secureNote: "Your API Key is encrypted at rest and never exposed in plaintext.",
  submit: "Save & get started",
  submitting: "Saving…",
  needApiKey: "Please enter a valid OpenAI API Key",
  saved: "All set!",
  savedHint: "Taking you in…",
  genericError: "Save failed, please try again.",
};

const WECHAT_ID = "xingze063";

export function SetupClient({ brand }: { brand: string }) {
  const { locale } = useI18n();
  const t = locale === "en" ? EN : ZH;
  const router = useRouter();

  const [apiKey, setApiKey] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [siteName, setSiteName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (apiKey.trim().length < 8) {
      setError(t.needApiKey);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          licenseKey: licenseKey.trim(),
          siteName: siteName.trim(),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error || t.genericError);
        setBusy(false);
        return;
      }
      setDone(true);
      // 让服务端重新判定「已配置」后进首页(router.refresh 触发 layout 门控放行)。
      setTimeout(() => {
        router.replace("/");
        router.refresh();
      }, 900);
    } catch {
      setError(t.genericError);
      setBusy(false);
    }
  }

  // 帮助文案里把微信号加粗渲染(zh/en 通用:按微信号切分前后两段)。
  const [helpBefore, helpAfter] = t.apiKeyHelp.split(WECHAT_ID);

  return (
    <div className="flex min-h-screen items-center justify-center bg-c-bg px-4 py-10">
      <div className="w-full max-w-xl">
        {/* 顶部欢迎 */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl [background:var(--grad-acc)] shadow-btn">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-[22px] font-semibold text-c-text">
            {t.welcome} {brand}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-c-text3">{t.subtitle}</p>
        </div>

        {/* 表单卡片 */}
        <div className="rounded-2xl border border-c-border2 bg-c-card p-6 shadow-btn sm:p-7">
          <p className="mb-5 text-[12.5px] leading-relaxed text-c-text3">
            {t.finishHint}
          </p>

          {done ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-c-tint-g">
                <Check className="h-6 w-6 text-c-success" />
              </div>
              <p className="text-[15px] font-semibold text-c-text">{t.saved}</p>
              <p className="text-[13px] text-c-text3">{t.savedHint}</p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* OpenAI API Key(必填) */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[13px] font-semibold text-c-text">
                  <KeyRound className="h-4 w-4 text-acc" />
                  {t.apiKeyLabel}
                  <span className="text-c-danger">*</span>
                </label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t.apiKeyPlaceholder}
                  error={!!error && apiKey.trim().length < 8}
                  disabled={busy}
                />
                <p className="text-[12px] leading-relaxed text-c-text3">
                  {helpBefore}
                  <span className="font-semibold text-c-text2">{WECHAT_ID}</span>
                  {helpAfter}
                </p>
              </div>

              {/* License Key(选填) */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[13px] font-semibold text-c-text">
                  {t.licenseLabel}
                  <span className="rounded-full bg-c-tint-v px-2 py-0.5 text-[10.5px] font-medium text-c-violet">
                    {t.licenseOptional}
                  </span>
                </label>
                <Input
                  type="text"
                  autoComplete="off"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder={t.licensePlaceholder}
                  disabled={busy}
                />
                <p className="text-[12px] leading-relaxed text-c-text3">
                  {t.licenseHelp}
                </p>
              </div>

              {/* 站点名称(选填) */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[13px] font-semibold text-c-text">
                  {t.siteNameLabel}
                  <span className="rounded-full bg-c-subtle px-2 py-0.5 text-[10.5px] font-medium text-c-text3">
                    {t.siteNameOptional}
                  </span>
                </label>
                <Input
                  type="text"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder={t.siteNamePlaceholder}
                  disabled={busy}
                />
                <p className="text-[12px] leading-relaxed text-c-text3">
                  {t.siteNameHelp}
                </p>
              </div>

              {error && (
                <p className="text-[12.5px] font-medium text-c-danger">{error}</p>
              )}

              <Button
                variant="primary"
                className="w-full"
                onClick={() => void submit()}
                disabled={busy}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? t.submitting : t.submit}
              </Button>

              <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-c-text4">
                <ShieldCheck className="h-3.5 w-3.5 text-c-success" />
                {t.secureNote}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
