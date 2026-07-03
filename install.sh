#!/usr/bin/env bash
# Novaryns one-line installer: clones the repo and starts app + Postgres via
# Docker Compose. Auto-configures a China registry mirror when Docker cannot
# pull from Docker Hub (mainland servers). Usage:
#   curl -fsSL https://raw.githubusercontent.com/usscottli-ctrl/novaryns/main/install.sh | bash
set -euo pipefail

REPO="https://github.com/usscottli-ctrl/novaryns"
DIR="${NOVARYNS_DIR:-novaryns}"

command -v git >/dev/null 2>&1 || { echo "✗ 需要 git,请先安装 / git is required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "✗ 需要 Docker,请先安装 / Docker is required: https://docs.docker.com/get-docker/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "✗ 需要 Docker Compose v2 / Docker Compose v2 is required"; exit 1; }

# --- 大陆网络:Docker 拉不动 Docker Hub 镜像时,自动配置国内加速 -------------
# 注意:必须用 dockerd 实测拉取,不能用 curl —— dockerd 是独立守护进程,
# 不走用户 shell 的代理/环境,curl 通不代表 dockerd 能拉。
pull_ok() { timeout "${1:-25}" docker pull hello-world >/dev/null 2>&1; }

ensure_mirror() {
  echo "→ 检测 Docker 镜像拉取能力 / testing Docker Hub pull ..."
  if pull_ok 25; then
    docker rmi hello-world >/dev/null 2>&1 || true
    return 0
  fi

  echo "→ 拉取超时,自动配置国内镜像加速 / Docker Hub unreachable, configuring China mirror ..."
  local SUDO=""; [ "$(id -u)" != 0 ] && SUDO="sudo"
  local f=/etc/docker/daemon.json
  $SUDO mkdir -p /etc/docker
  if [ -f "$f" ] && grep -q registry-mirrors "$f"; then
    echo "  已有 registry-mirrors,仅重启使其生效 / restarting to apply existing mirror"
  elif [ -f "$f" ] && command -v python3 >/dev/null 2>&1; then
    $SUDO python3 - "$f" <<'PY'
import json, sys
p = sys.argv[1]
try:
    d = json.load(open(p))
    if not isinstance(d, dict): d = {}
except Exception:
    d = {}
d.setdefault("registry-mirrors", [
    "https://docker.m.daocloud.io",
    "https://docker.1panel.live",
    "https://dockerpull.org",
])
json.dump(d, open(p, "w"), indent=2)
PY
  else
    $SUDO tee "$f" >/dev/null <<'JSON'
{ "registry-mirrors": ["https://docker.m.daocloud.io", "https://docker.1panel.live", "https://dockerpull.org"] }
JSON
  fi

  echo "→ 重启 Docker / restarting Docker ..."
  $SUDO systemctl restart docker 2>/dev/null || $SUDO service docker restart 2>/dev/null || true
  local i; for i in $(seq 1 20); do docker info >/dev/null 2>&1 && break; sleep 1; done

  echo "→ 复测拉取 / re-testing pull ..."
  if pull_ok 40; then
    docker rmi hello-world >/dev/null 2>&1 || true
    echo "  ✓ 镜像加速已生效 / mirror is working"
    return 0
  fi

  echo ""
  echo "✗ 公共镜像加速仍无法拉取 Docker Hub 镜像(你的服务器网络对这些源也不通)。"
  echo "  最稳的办法:到阿里云容器镜像服务领取你的【专属加速器地址】(免费):"
  echo "    https://cr.console.aliyun.com/  →  左侧「镜像加速器」"
  echo "  复制形如 https://xxxx.mirror.aliyuncs.com 的地址,写入 /etc/docker/daemon.json"
  echo "  的 registry-mirrors,然后:  sudo systemctl restart docker  再重跑本命令。"
  exit 1
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
echo "  打开 http://<服务器公网IP>:3000 完成首启配置(填 OpenAI API Key 即可用)。"
echo "  记得在云厂商安全组放行 3000 端口。"
echo ""
echo "  ⚠ 大陆服务器还需在配置里设 OPENAI_BASE_URL 中转,详见 README「中国大陆服务器部署」。"
echo "  不知道 API Key 怎么获取?联系作者微信 xingze063。"
