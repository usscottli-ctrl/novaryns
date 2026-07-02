"use client";

import { Component, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/locale-context";

type Props = { children: ReactNode };
type State = { error: Error | null };

// 错误兜底界面(函数组件,才能用 useI18n;类组件无法直接用 hook)。
function CanvasErrorFallback({
  error,
  onRetry,
  onBack,
}: {
  error: Error;
  onRetry: () => void;
  onBack: () => void;
}) {
  const { locale } = useI18n();
  const L = (z: string, e: string) => (locale === "en" ? e : z);
  return (
    <div className="dark flex h-dvh flex-col items-center justify-center gap-4 bg-[#0e0f13] px-6 text-center text-[#e7e9ee]">
      <div className="text-lg font-bold">{L("画布出错了", "Canvas crashed")}</div>
      <pre className="max-w-2xl overflow-auto rounded-lg border border-[#2a2d36] bg-[#191b21] p-4 text-left text-xs text-[#9aa1ae]">
        {error.message}
        {error.stack ? `\n\n${error.stack.split("\n").slice(0, 6).join("\n")}` : ""}
      </pre>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-[#6366f1] px-4 py-2 text-sm font-semibold text-white"
        >
          {L("重试", "Retry")}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-[#2a2d36] bg-[#191b21] px-4 py-2 text-sm font-semibold"
        >
          {L("返回项目网格", "Back to project grid")}
        </button>
      </div>
    </div>
  );
}

// 画布错误边界:任何渲染崩溃都在这里兜住,显示真实报错(而不是整页白屏),
// 方便定位 + 一键重试,不至于让用户卡在 "Application error"。
export class CanvasErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // 在 console 留下完整堆栈,便于排查
    console.error("[canvas crash]", error, info);
  }

  render() {
    const err = this.state.error;
    if (err) {
      return (
        <CanvasErrorFallback
          error={err}
          onRetry={() => this.setState({ error: null })}
          onBack={() => {
            try {
              localStorage.removeItem("nv:canvas:last");
            } catch {
              /* ignore */
            }
            location.href = "/canvas";
          }}
        />
      );
    }
    return this.props.children;
  }
}
