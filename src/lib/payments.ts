import "server-only";
import {
  getCreditPack,
  fmtCredits,
  RMB_PACK_FEN,
  RMB_PRO_LICENSE_FEN,
  RMB_CLOUD_FEN,
} from "@/lib/mock-data";
import { subdomainError, cloudDomainFor, findComputePack, parseCloudItemId } from "@/lib/cloud";

// RMB charge amounts (分) come from mock-data so the displayed price and the
// amount actually charged share one source of truth — see RMB_PACK_FEN there.
export { RMB_PACK_FEN };

export type ResolvedItem = {
  kind: "pack" | "pro" | "cloud" | "compute";
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
  if (kind === "compute") {
    // 云端租户算力包:itemId = "<包id>:<中转token id>"。付款后 fulfillOrder 给该
    // token 加配额(积分),不发站内积分。credits=0 防止误入积分批次逻辑。
    const [packId, tokenId] = itemId.split(":");
    const pack = findComputePack(packId || "");
    if (!pack || !/^[0-9a-f]{16}$/.test(tokenId || "")) return null;
    return {
      kind: "compute",
      itemId,
      title: `云端算力包 ${pack.credits.toLocaleString()} 积分`,
      credits: 0,
      amount: pack.fen,
    };
  }
  if (kind === "cloud") {
    // 云端托管:itemId = 买家选定的子域名。付款后 fulfillOrder 自动开通
    // <子域>.starzeco.com 专属实例(不发积分)。子域名在此做格式/保留字校验,
    // 是否被占用由 /api/cloud/check-name + 开通时的唯一约束把关。
    // itemId = "<子域名>@<套餐id>"(monthly/yearly);没带套餐的历史订单按年付。
    const { sub, plan } = parseCloudItemId(itemId);
    if (subdomainError(sub)) return null;
    // 已下架的套餐(2026-09-15 起月付)不接新单 —— 前端不展示不够,得在服务端卡住
    if (!plan.onSale) return null;
    return {
      kind: "cloud",
      itemId: `${sub}@${plan.id}`,
      title: `云端托管实例 ${cloudDomainFor(sub)}(${plan.label})`,
      credits: 0,
      amount: plan.fen,
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
