"use client";

import * as React from "react";
import { Check, X, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";
type ToastItem = { id: number; message: string; type: ToastType };
type ToastCtx = { toast: (message: string, type?: ToastType) => void };

const Ctx = React.createContext<ToastCtx | null>(null);
let _id = 0;

/** 全局 Toast(spec B.7)。挂在根 layout;2200ms 自动消失(critic C4)。 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const toast = React.useCallback((message: string, type: ToastType = "success") => {
    const id = ++_id;
    setItems((s) => [...s, { id, message, type }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 2200);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-7 z-[200] flex flex-col items-center gap-2">
        {items.map((t) => (
          <ToastRow key={t.id} item={t} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = React.useContext(Ctx);
  return ctx ?? { toast: () => {} };
}

function ToastRow({ item }: { item: ToastItem }) {
  const Icon = item.type === "success" ? Check : item.type === "error" ? X : Info;
  const stroke =
    item.type === "success"
      ? "#34CCA4"
      : item.type === "error"
      ? "var(--c-danger)"
      : "var(--acc)";
  return (
    <div
      className={cn(
        "nv-menu-up pointer-events-auto inline-flex items-center gap-2 rounded-[11px] px-4 py-2.5 text-[13px] font-medium text-white shadow-toast",
        "bg-[rgba(22,24,29,.9)]"
      )}
    >
      <Icon size={15} strokeWidth={2.4} style={{ color: stroke }} />
      <span>{item.message}</span>
    </div>
  );
}
