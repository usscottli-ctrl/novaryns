#!/usr/bin/env bash
# Novaryns one-line installer: clones the repo and starts app + Postgres via
# Docker Compose. Usage:
#   curl -fsSL https://raw.githubusercontent.com/usscottli-ctrl/novaryns/main/install.sh | bash
set -euo pipefail

REPO="https://github.com/usscottli-ctrl/novaryns"
DIR="${NOVARYNS_DIR:-novaryns}"

command -v git >/dev/null 2>&1 || { echo "✗ 需要 git,请先安装 / git is required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "✗ 需要 Docker,请先安装 / Docker is required: https://docs.docker.com/get-docker/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "✗ 需要 Docker Compose v2 / Docker Compose v2 is required"; exit 1; }

if [ -d "$DIR" ]; then
  echo "→ 目录 $DIR 已存在,拉取最新代码 / updating existing checkout"
  git -C "$DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"
docker compose up -d --build

echo ""
echo "✓ Novaryns 已启动 / started."
echo "  打开 http://localhost:3000 完成首启配置(填 OpenAI API Key 即可用)。"
echo "  Open http://localhost:3000 and finish the first-run wizard."
echo ""
echo "  不知道 API Key 怎么获取?联系作者微信 xingze063。"
