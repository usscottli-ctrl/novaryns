#!/usr/bin/env bash
# Novaryns one-line installer: clones the repo and starts app + Postgres via
# Docker Compose. Auto-configures a China registry mirror when Docker Hub is
# unreachable (mainland servers). Usage:
#   curl -fsSL https://raw.githubusercontent.com/usscottli-ctrl/novaryns/main/install.sh | bash
set -euo pipefail

REPO="https://github.com/usscottli-ctrl/novaryns"
DIR="${NOVARYNS_DIR:-novaryns}"
MIRROR="https://docker.m.daocloud.io"

command -v git >/dev/null 2>&1 || { echo "✗ 需要 git,请先安装 / git is required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "✗ 需要 Docker,请先安装 / Docker is required: https://docs.docker.com/get-docker/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "✗ 需要 Docker Compose v2 / Docker Compose v2 is required"; exit 1; }

# --- 大陆网络:Docker Hub 直连不通时,自动配置国内镜像加速 ------------------
ensure_mirror() {
  command -v curl >/dev/null 2>&1 || return 0
  # 拿到任意 HTTP 状态码 = TCP/TLS 通(401 也算);000 = 连不上(超时/DNS)。
  local code
  code=$(curl -s -m 6 -o /dev/null -w '%{http_code}' https://registry-1.docker.io/v2/ 2>/dev/null || echo 000)
  [ "$code" != "000" ] && return 0

  echo "→ 检测到无法直连 Docker Hub,自动配置国内镜像加速 / Docker Hub unreachable, configuring China mirror"
  local SUDO=""; [ "$(id -u)" != 0 ] && SUDO="sudo"
  local f=/etc/docker/daemon.json
  $SUDO mkdir -p /etc/docker
  if [ -f "$f" ] && grep -q registry-mirrors "$f"; then
    echo "  已有 registry-mirrors,尊重现有配置 / mirror already configured, leaving as-is"
  elif [ -f "$f" ] && command -v python3 >/dev/null 2>&1; then
    # 安全合并:保留用户已有的其它键
    $SUDO python3 - "$f" "$MIRROR" <<'PY'
import json, sys
path, mirror = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(path))
    if not isinstance(d, dict): d = {}
except Exception:
    d = {}
d.setdefault("registry-mirrors", [mirror])
json.dump(d, open(path, "w"), indent=2)
PY
  else
    echo "{ \"registry-mirrors\": [\"$MIRROR\"] }" | $SUDO tee "$f" >/dev/null
  fi

  echo "→ 重启 Docker 使加速生效 / restarting Docker"
  $SUDO systemctl restart docker 2>/dev/null || $SUDO service docker restart 2>/dev/null || true
  local i
  for i in $(seq 1 20); do docker info >/dev/null 2>&1 && break; sleep 1; done
}
ensure_mirror

if [ -d "$DIR" ]; then
  echo "→ 目录 $DIR 已存在,拉取最新代码 / updating existing checkout"
  git -C "$DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"
echo "→ 拉取镜像并启动(首次较慢,请耐心)/ pulling images & starting (first run is slow)"
docker compose up -d --build

echo ""
echo "✓ Novaryns 已启动 / started."
echo "  打开 http://<服务器IP>:3000 完成首启配置(填 OpenAI API Key 即可用)。"
echo "  Open http://<server-ip>:3000 and finish the first-run wizard."
echo ""
echo "  ⚠ 大陆服务器还需在配置里设 OPENAI_BASE_URL 中转,详见 README「中国大陆服务器部署」。"
echo "  不知道 API Key 怎么获取?联系作者微信 xingze063。"
