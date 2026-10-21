import "server-only";

// 邀请有奖:好友点 /?invite=码 进站时前端把码写进这个 cookie(30 天),注册时服务端读出来绑定。
export const INVITE_COOKIE = "nv_invite";

/** 本次注册用的邀请码:注册表单里手填的优先,其次是访问邀请链接时记下的 cookie。 */
export function inviteCodeFrom(req: Request, explicit?: string | null): string {
  const typed = String(explicit ?? "").trim();
  if (typed) return typed;
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)nv_invite=([A-Za-z0-9]{4,12})/);
  return m?.[1] ?? "";
}
