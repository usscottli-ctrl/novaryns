"use client";

import { cdnUrl } from "@/lib/cdn";
import { useEffect, useRef, useState } from "react";
import {
  ShieldCheck,
  X,
  ImagePlus,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ToolShell } from "@/components/tools/tool-shell";
import { ToolDemo, getDemo } from "@/components/tools/tool-demo";
import { GenLoader } from "@/components/gen-loader";

const MAX_UPLOAD = 12 * 1024 * 1024;
const COST = 1;
const ACCENT = "#C2882E";

type IpResult = {
  risk?: "high" | "medium" | "low";
  riskLabel?: string;
  summary?: string;
  items?: { name?: string; reason?: string }[];
  advice?: string;
};

// 风险语义色(红/琥珀/翠绿)—— 保留用于风险徽标与风险框,不走 c-* token。
const RISK_STYLE: Record<
  string,
  { box: string; badge: string; zh: string; en: string }
> = {
  high: {
    box: "border-red-300 bg-red-50",
    badge: "bg-red-600",
    zh: "高风险",
    en: "High risk",
  },
  medium: {
    box: "border-amber-300 bg-amber-50",
    badge: "bg-amber-500",
    zh: "中风险",
    en: "Medium risk",
  },
  low: {
    box: "border-emerald-300 bg-emerald-50",
    badge: "bg-emerald-600",
    zh: "低风险",
    en: "Low risk",
  },
};

export function IpcheckClient() {
  const { user, remaining, consumeCredits, applyServerUser } = useAuth();
  const { openAuth } = useAuthModal();
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);

  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [img, setImg] = useState<{ file: File; url: string } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<IpResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (img) URL.revokeObjectURL(img.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(f: File) {
    if (!user) return openAuth();
    if (f.size > MAX_UPLOAD)
      return setError(L("图片需小于 12MB", "Image must be < 12MB"));
    setError(null);
    if (img) URL.revokeObjectURL(img.url);
    setImg({ file: f, url: URL.createObjectURL(f) });
    setResult(null);
  }

  async function run() {
    if (!user) return openAuth();
    if (busyRef.current) return;
    if (!img) return setError(L("请先上传图片", "Upload an image first"));
    if (remaining < COST)
      return setError(
        L(
          `积分不足:需 ${COST},剩余 ${remaining}`,
          `Need ${COST}, have ${remaining}`
        )
      );
    setError(null);
    busyRef.current = true;
    setProcessing(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("image", img.file);
      if (user) fd.append("email", user.email);
      const res = await fetch("/api/ipcheck", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.result)
        throw new Error(data.error ?? L("检测失败", "Failed"));
      if (data.user) applyServerUser(data.user);
      else if (data.creditsUsed) consumeCredits(data.creditsUsed);
      setResult(data.result as IpResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : L("检测失败", "Failed"));
    } finally {
      busyRef.current = false;
      setProcessing(false);
    }
  }

  const rs = result ? RISK_STYLE[result.risk ?? "low"] ?? RISK_STYLE.low : null;

  return (
    <ToolShell
      name={L("侵权检测", "IP Check")}
      desc={L(
        "快速筛查图片版权风险,规避商用侵权纠纷",
        "Screen images for IP/copyright risk before commercial use"
      )}
      Icon={ShieldCheck}
      tint="var(--c-tint-a)"
      accent={ACCENT}
      category="ipcheck"
      cost={COST}
      actionLabel={L("开始检测", "Check")}
      onAction={run}
      processing={processing}
      disabled={!img}
      error={error}
      resultTitle={L("检测结果", "Result")}
      refreshKey={result ? 1 : 0}
      left={
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pick(f);
              e.target.value = "";
            }}
          />

          <div>
            <p className="mb-2 text-[12.5px] font-medium text-c-text2">
              {L("原图", "Image")} <span className="text-c-danger">*</span>
            </p>
            {img ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cdnUrl(img.url)}
                  alt="src"
                  className="h-16 w-16 rounded-field border border-c-border bg-c-subtle2 object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(img.url);
                    setImg(null);
                    setResult(null);
                  }}
                  aria-label={L("移除", "Remove")}
                  className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/70"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title={L("png/jpg,< 12MB", "png/jpg, < 12MB")}
                className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-field border-[1.5px] border-dashed border-c-border2 bg-c-subtle2 text-c-text3 transition-colors hover:border-acc hover:text-acc"
              >
                <ImagePlus className="h-4 w-4" />
                <span className="text-[10px]">{L("上传", "Upload")}</span>
              </button>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-c-text3">
            {L(
              "AI 辅助筛查图片中的商标、品牌、名人肖像、知名 IP 等版权风险,商用前先过一遍。",
              "AI screens the image for trademarks, brands, celebrity likeness and known IP before commercial use."
            )}
          </p>
        </>
      }
    >
      {() => (
        <div className="flex min-h-0 flex-1 flex-col">
          {processing ? (
            <div className="relative min-h-[300px] w-full flex-1">
              <GenLoader />
            </div>
          ) : result && rs ? (
            <div className="space-y-4">
              <div
                className={cn(
                  "flex items-center gap-3 rounded-card border p-4",
                  rs.box
                )}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 flex-none items-center justify-center rounded-full text-white",
                    rs.badge
                  )}
                >
                  {result.risk === "low" ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <AlertTriangle className="h-5 w-5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-c-text">
                    {result.riskLabel || L(rs.zh, rs.en)}
                  </p>
                  {result.summary && (
                    <p className="text-[13px] text-c-text2">{result.summary}</p>
                  )}
                </div>
              </div>

              {result.items && result.items.length > 0 && (
                <div className="rounded-card border border-c-border bg-c-card p-4">
                  <p className="mb-2 text-[13px] font-semibold text-c-text">
                    {L("风险点", "Risk items")}
                  </p>
                  <ul className="space-y-2">
                    {result.items.map((it, i) => (
                      <li key={i} className="flex gap-2 text-[13px] text-c-text">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-500" />
                        <span>
                          <b>{it.name}</b>
                          {it.reason ? (
                            <span className="text-c-text3"> —— {it.reason}</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.advice && (
                <div className="rounded-card border border-c-border bg-c-subtle p-4 text-[13px]">
                  <p className="mb-1 font-semibold text-c-text">
                    {L("商用建议", "Advice")}
                  </p>
                  <p className="text-c-text2">{result.advice}</p>
                </div>
              )}
              <p className="text-center text-[11px] text-c-text3">
                {L(
                  "AI 辅助筛查,仅供参考,不构成法律意见",
                  "AI screening for reference only, not legal advice"
                )}
              </p>
            </div>
          ) : (
            <ToolDemo {...getDemo("ipcheck")!} />
          )}
        </div>
      )}
    </ToolShell>
  );
}
