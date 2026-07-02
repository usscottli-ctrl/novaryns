import { NextResponse, type NextRequest } from "next/server";

// 轻量中间件:把当前请求路径写进 x-pathname 请求头,供根 layout(RSC)读取以做
// 「未配置 → 引导到 /setup」的门控。这里不碰 DB/加密,只贴一个 header,开销极小。
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

// 只对页面请求生效;排除 API、Next 静态资源、图片、favicon 等,避免无谓开销。
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
