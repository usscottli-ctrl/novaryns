"use client";

import * as React from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Pro 授权弹窗。爱发电流程:买家购买后获得 License Key → 在此输入验证
 * (POST /api/pro/redeem)→ 显示一键部署命令 + License Key。
 * 镜像公开、填 Key 解锁 Pro,所以"发货"= 一个 License Key。
 * 爱发电仅用于 Pro 授权销售,与站内积分兑换码无关。
 */
export function ProDownloadModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [code, setCode] = React.useState("");
  const [verified, setVerified] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [copied, setCopied] = React.useState<"docker" | "license" | null>(null);
  const [info, setInfo] = React.useState<{
    licenseKey: string;
    dockerRun: string;
    expiresAt: string | null;
  } | null>(null);

  // 关闭时重置内部态,下次打开是干净流程。
  React.useEffect(() => {
    if (!open) {
      setCode("");
      setVerified(false);
      setVerifying(false);
      setCopied(null);
      setInfo(null);
    }
  }, [open]);

  async function handleVerify() {
    const trimmed = code.trim();
    if (!trimmed) {
      toast("请先填写 License Key", "error");
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch("/api/pro/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast(data.error || "验证失败", "error");
        return;
      }
      setInfo({
        licenseKey: data.licenseKey,
        dockerRun: data.dockerRun,
        expiresAt: data.expiresAt ?? null,
      });
      setVerified(true);
      toast("授权有效", "success");
    } catch {
      toast("网络异常,请稍后再试", "error");
    } finally {
      setVerifying(false);
    }
  }

  function copyText(text: string, key: "docker" | "license") {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
      },
      () => toast("复制失败,请手动选择", "error")
    );
  }

  return (
    <Modal open={open} onClose={onClose} width={480}>
      <div className="pr-6">
        <h2 className="text-[18px] font-bold leading-tight text-c-text">
          获取 Pro 授权
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-c-text3">
          Pro 授权通过爱发电发放。购买后在订单中获取 License Key,在下方验证即可拿到一键部署命令;镜像公开,填入 License Key 即解锁 Pro 全部能力。
        </p>
      </div>

      {!verified ? (
        <div className="mt-5">
          <label className="mb-1.5 block text-[12.5px] font-medium text-c-text2">
            License Key（爱发电购买后获得）
          </label>
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleVerify();
              }}
              placeholder="NOVA-XXXX-XXXX-XXXX-XXXX"
              className="flex-1 font-mono tracking-wide"
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              variant="primary"
              onClick={handleVerify}
              loading={verifying}
              className="shrink-0"
            >
              验证
            </Button>
          </div>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-c-text4">
            爱发电仅用于 Pro 授权销售,与站内积分兑换码无关。
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-2 rounded-[10px] border border-c-success bg-c-tint-g px-3.5 py-2.5">
            <Check size={16} className="shrink-0 text-c-success" strokeWidth={2.6} />
            <span className="text-[12.5px] font-medium text-c-text2">
              授权有效
              {info?.expiresAt
                ? ` —— 有效期至 ${new Date(info.expiresAt).toLocaleDateString("zh-CN")}`
                : " —— 永久有效"}
            </span>
          </div>

          {/* Docker 一键部署 */}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-c-text3">
              一键部署（填入下方 License Key 即解锁 Pro）
            </label>
            <div className="relative">
              <pre className="overflow-x-auto rounded-[10px] bg-[#15161B] p-3.5 pr-12 font-mono text-[12px] leading-relaxed text-[#E6E8EC]">
                {info?.dockerRun}
              </pre>
              <button
                type="button"
                onClick={() => copyText(info?.dockerRun ?? "", "docker")}
                className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-[7px] bg-[rgba(255,255,255,.08)] px-2 py-1 text-[11px] font-medium text-[#E6E8EC] transition-colors hover:bg-[rgba(255,255,255,.16)]"
              >
                {copied === "docker" ? <Check size={12} /> : <Copy size={12} />}
                {copied === "docker" ? "已复制" : "复制"}
              </button>
            </div>
          </div>

          {/* License Key */}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-c-text3">
              License Key
            </label>
            <div className="flex items-center gap-2 rounded-[10px] border border-c-border2 bg-c-subtle2 px-3.5 py-2.5">
              <KeyRound size={14} className="shrink-0 text-acc" />
              <span className="flex-1 select-all font-mono text-[13px] tracking-wide text-c-text">
                {info?.licenseKey}
              </span>
              <button
                type="button"
                onClick={() => copyText(info?.licenseKey ?? "", "license")}
                className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11.5px] font-medium text-c-text3 transition-colors hover:bg-c-subtle hover:text-c-text"
              >
                {copied === "license" ? <Check size={12} /> : <Copy size={12} />}
                {copied === "license" ? "已复制" : "复制"}
              </button>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-c-text4">
              部署后在「License Key 激活」处填入即可解锁 Pro 全部能力。
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
