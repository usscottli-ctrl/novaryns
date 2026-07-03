import "server-only";
import {
  getCreditPack,
  fmtCredits,
  RMB_PACK_FEN,
  RMB_PRO_LICENSE_FEN,
} from "@/lib/mock-data";

// RMB charge amounts (分) come from mock-data so the displayed price and the
// amount actually charged share one source of truth — see RMB_PACK_FEN there.
export { RMB_PACK_FEN };

export type ResolvedItem = {
  kind: "pack" | "pro";
  itemId: string;
  title: string;
  credits: number;
  amount: number; // 分
};

// 商品:积分充值包(pack)+ Pro 商业授权直售(pro)。服务端解析,价格不可被前端篡改。
export function resolveItem(kind: string, itemId: string): ResolvedItem | null {
  if (kind === "pro") {
    // Pro 授权直售:付款后 fulfillOrder 自动生成 License Key 绑定买家邮箱(不发积分)。
    if (itemId !== "pro-1y") return null;
    return {
      kind: "pro",
      itemId,
      title: "Pro 商业授权(1 年)",
      credits: 0,
      amount: RMB_PRO_LICENSE_FEN,
    };
  }
  if (kind !== "pack") return null;
  const pack = getCreditPack(itemId);
  if (!pack) return null;
  return {
    kind: "pack",
    itemId,
    title: `${fmtCredits(pack.credits)} 积分`,
    credits: pack.credits,
    amount: pack.fen,
  };
}
