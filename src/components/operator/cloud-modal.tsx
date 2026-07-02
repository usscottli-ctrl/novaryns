"use client";

import * as React from "react";
import { Check, Cloud, Copy, MessageCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * 云端托管开通弹窗(MVP:人工开通)。
 * 流程:加作者微信(备注「云端托管」)→ 沟通域名/品牌/算力方案 → 1 个工作日内交付
 * 独立白标实例。后续量大再做自动开通(建租户+域名映射+按量积分)。
 */
const WECHAT_ID = "xingze063";

const BENEFITS = [
  "免部署 · 自动更新,无需自己的服务器",
  "独立实例 · 绑定你自己的域名(CNAME)",
  "全白标:自有品牌名 / Logo,无平台署名",
  "含算力积分,超出按量购买",
  "优先支持 · 一对一开通对接",
];

export function CloudModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  const copyWechat = async () => {
    try {
      await navigator.clipboard.writeText(WECHAT_ID);
      setCopied(true);
      toast("微信号已复制", "success");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("复制失败,请手动输入", "error");
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={460}>
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-c-tint-b">
          <Cloud className="h-5 w-5 text-c-blue" />
        </span>
        <div>
          <h3 className="text-[16px] font-bold text-c-text">云端托管开通</h3>
          <p className="text-[12.5px] text-c-text3">
            <span className="font-bold text-c-text">¥3,999</span> /年起 · 免运维
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {BENEFITS.map((b) => (
          <li key={b} className="flex items-start gap-2 text-[13px] text-c-text2">
            <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-c-blue" />
            {b}
          </li>
        ))}
      </ul>

      {/* 开通步骤 */}
      <div className="mt-4 rounded-xl bg-c-subtle2 p-3.5">
        <p className="text-[12px] font-semibold text-c-text2">开通流程</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-c-text3">
          <li>
            加作者微信 <b className="text-c-text">{WECHAT_ID}</b>(备注「云端托管」)
          </li>
          <li>沟通域名、品牌与算力方案</li>
          <li>1 个工作日内开通交付你的专属实例</li>
        </ol>
      </div>

      <Button variant="primary" className="mt-4 w-full" onClick={copyWechat}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        复制微信号 {WECHAT_ID}
      </Button>
      <p className="mt-2 flex items-center justify-center gap-1 text-[11.5px] text-c-text4">
        <MessageCircle className="h-3.5 w-3.5" />
        通过微信一对一开通,支持开具凭证
      </p>
    </Modal>
  );
}
