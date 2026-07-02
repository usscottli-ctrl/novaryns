// 首页对话框选的参考图 → 带到 /genchat 首轮生成。
// 客户端路由跳转不会刷新页面,模块级变量在导航后仍存活,比 sessionStorage 更稳(不受大小限制)。
let pending: File[] = [];

export function setPendingRefs(files: File[]): void {
  pending = files;
}

export function takePendingRefs(): File[] {
  const r = pending;
  pending = [];
  return r;
}
