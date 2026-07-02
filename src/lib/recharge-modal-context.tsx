"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type RechargeTab = "pay" | "code";

type Ctx = {
  open: boolean;
  tab: RechargeTab;
  openRecharge: (tab?: RechargeTab) => void;
  closeRecharge: () => void;
  setTab: (tab: RechargeTab) => void;
};

const RechargeModalContext = createContext<Ctx | null>(null);

export function RechargeModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<RechargeTab>("pay");

  const openRecharge = useCallback((t: RechargeTab = "pay") => {
    setTab(t);
    setOpen(true);
  }, []);
  const closeRecharge = useCallback(() => setOpen(false), []);

  const value = useMemo<Ctx>(
    () => ({ open, tab, openRecharge, closeRecharge, setTab }),
    [open, tab, openRecharge, closeRecharge]
  );

  return (
    <RechargeModalContext.Provider value={value}>
      {children}
    </RechargeModalContext.Provider>
  );
}

/** Safe-to-call:在 Provider 外用返回 no-op。 */
export function useRecharge(): Ctx {
  const c = useContext(RechargeModalContext);
  if (!c) {
    return {
      open: false,
      tab: "pay",
      openRecharge: () => {},
      closeRecharge: () => {},
      setTab: () => {},
    };
  }
  return c;
}
