"use client";

import * as React from "react";

// 作品保留天数 —— 工具页底部「生成结果将自动保存到作品库,保留 N 天」的 N。
// 唯一来源是服务端 env `ARTWORK_KEEP_DAYS`(默认 180,经 /api/config 下发),
// 与后台「存储治理」的清理口径一致。之前这句话在 5 个页面里写死 180 天,
// 而客户站的图片存储设的是 10 天自动删除 —— 页面说 180 天会误导用户。
// 模块级缓存:全站只请求一次。
let cached: Promise<number> | null = null;

function load(): Promise<number> {
  cached ??= fetch("/api/config", { cache: "no-store" })
    .then((r) => r.json())
    .then((d) => (Number(d.artworkKeepDays) > 0 ? Number(d.artworkKeepDays) : 180))
    .catch(() => 180);
  return cached;
}

export function useArtworkKeepDays(): number {
  const [days, setDays] = React.useState(180);
  React.useEffect(() => {
    let alive = true;
    void load().then((d) => alive && setDays(d));
    return () => {
      alive = false;
    };
  }, []);
  return days;
}

/** 底部提示文案(中英)。 */
export function keepNote(days: number, en = false): string {
  return en
    ? `Results are auto-saved to your Library for ${days} days`
    : `生成结果将自动保存到「作品库」,保留 ${days} 天${days <= 30 ? ",请及时下载" : ""}`;
}
