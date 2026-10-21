"use client";

import * as React from "react";

// 站长是否开启了「邀请有奖」(经 /api/config 下发)。没开就不显示入口。模块级缓存:全站只请求一次。
let cached: Promise<boolean> | null = null;

export function useInviteEnabled(): boolean {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    cached ??= fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d.inviteEnabled === true)
      .catch(() => false);
    void cached.then((v) => alive && setOn(v));
    return () => {
      alive = false;
    };
  }, []);
  return on;
}
