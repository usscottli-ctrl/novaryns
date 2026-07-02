import "server-only";
import {
  getCreditPack,
  fmtCredits,
  RMB_PACK_FEN,
} from "@/lib/mock-data";

// RMB charge amounts (分) come from mock-data so the displayed price and the
// amount actually charged share one source of truth — see RMB_PACK_FEN there.
export { RMB_PACK_FEN };

export type ResolvedItem = {
  kind: "pack";
  itemId: string;
  title: string;
  credits: number;
  amount: number; // 分
};

// 月度会员已下线 → 只剩积分充值包。服务端解析,价格/积分不可被前端篡改。
export function resolveItem(kind: string, itemId: string): ResolvedItem | null {
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
