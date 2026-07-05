import "server-only";

// 构建版本号 = 构建时的 Unix 时间戳(秒),build 期通过 env BUILD_VERSION 注入:
//   · 开源镜像:Dockerfile ARG/ENV BUILD_VERSION(CI 传 date +%s)。
//   · 官方站:部署时 `BUILD_VERSION=$(date +%s) pm2 restart --update-env`。
// 用时间戳而非 git sha —— 主仓与开源仓是两个仓,sha 不可比;时间戳全局可比,
// 谁的更大谁更新。未注入时返回 "0"(视为未知,不误报更新)。
export function buildVersion(): string {
  return (process.env.BUILD_VERSION || "0").trim();
}

// 供后台更新检查:向"官方版本服务器"查最新构建版本。默认 ai.starzeco.com。
export function updateServer(): string {
  return (process.env.UPDATE_SERVER_URL || "https://ai.starzeco.com").replace(
    /\/$/,
    ""
  );
}
