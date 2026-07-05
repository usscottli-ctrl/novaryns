#!/usr/bin/env bash
# Novaryns one-line installer: clones the repo and starts app + Postgres via
# Docker Compose. Auto-configures a China registry mirror when Docker cannot
# pull from Docker Hub (mainland servers). Usage:
#   curl -fsSL https://raw.githubusercontent.com/usscottli-ctrl/novaryns/main/install.sh | bash
set -euo pipefail

REPO="https://github.com/usscottli-ctrl/novaryns"

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

# 自动定位已有安装(不依赖当前目录):按镜像名问 Docker 我们的容器装在哪。
# 找到 = 就地更新(数据保留);找不到 = 全新装到 $HOME/novaryns(绝对路径,在哪跑都一致)。
detect_existing() {
  docker ps -a --format '{{.Image}}\t{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null \
    | grep -i 'novaryns' | awk -F'\t' 'NF>1 && $2!="" {print $2; exit}'
}
DIR="${NOVARYNS_DIR:-}"
if [ -z "$DIR" ]; then
  DIR="$(detect_existing || true)"
  if [ -z "$DIR" ]; then
    for c in "$PWD/novaryns" "$HOME/novaryns" /root/novaryns /opt/novaryns "$PWD"; do
      if [ -f "$c/docker-compose.yml" ] && grep -qi novaryns "$c/docker-compose.yml" 2>/dev/null; then
        DIR="$c"; break
      fi
    done
  fi
fi

if [ -n "$DIR" ] && [ -d "$DIR" ]; then
  echo "→ 检测到已安装于:$DIR —— 执行更新(数据保留)/ found existing install, updating"
  git -C "$DIR" pull --ff-only 2>/dev/null || echo "  (本地有改动,跳过代码更新,仅更新镜像)"
else
  DIR="${DIR:-$HOME/novaryns}"
  echo "→ 全新安装到:$DIR / fresh install"
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"

# 80 已被占用(常见于宝塔面板自带 Nginx / 已有 web 服务)→ 自动改用 8080,避免端口冲突。
if [ -z "${HTTP_PORT:-}" ]; then
  if ss -tlnH 2>/dev/null | awk '{print $4}' | grep -qE ':80$'      || lsof -iTCP:80 -sTCP:LISTEN >/dev/null 2>&1; then
    export HTTP_PORT=8080
    echo "→ 检测到 80 端口已被占用(可能是宝塔/Nginx),本应用改用 8080 端口 / port 80 busy, using 8080"
  fi
fi

# 应用镜像:优先拉【预构建镜像】(免本地编译,快得多)。直连 ghcr.io 慢/不通时,
# 自动改走国内公益镜像并回标成 ghcr.io 名字;全部拉取失败才回退本地构建(--build)。
APP_IMAGE="ghcr.io/usscottli-ctrl/novaryns:latest"
GHCR_MIRRORS="ghcr.nju.edu.cn/usscottli-ctrl/novaryns:latest ghcr.dockerproxy.net/usscottli-ctrl/novaryns:latest"

pull_app_image() {
  echo "→ 拉取预构建应用镜像(免本地编译)/ pulling prebuilt app image ..."
  # 先走国内公益镜像 —— 实测大陆 9 秒拉完 361MB;直连 ghcr.io 握手快但拉层极慢。
  local m
  for m in $GHCR_MIRRORS; do
    if timeout 180 docker pull "$m" >/dev/null 2>&1; then
      docker tag "$m" "$APP_IMAGE"
      docker rmi "$m" >/dev/null 2>&1 || true
      echo "  ✓ 通过 ${m%%/*} 拉取成功 / pulled via mirror"
      return 0
    fi
  done
  # 镜像都不可用(如海外网络)→ 回退直连 ghcr.io(海外快,大陆慢但能成)。
  echo "  国内镜像不可用,改直连 ghcr.io / mirrors unavailable, trying ghcr.io direct ..."
  if timeout 300 docker pull "$APP_IMAGE" >/dev/null 2>&1; then
    echo "  ✓ 直连 ghcr.io 成功 / pulled from ghcr.io"
    return 0
  fi
  echo "  ⚠ 预构建镜像均拉取失败,回退到本地构建(较慢)/ falling back to local build"
  return 1
}

echo "→ 启动 Novaryns / starting ..."
if pull_app_image; then
  docker compose up -d
else
  docker compose up -d --build
fi

# 尽量探测公网 IP,打印可直接点开的地址(阿里云元数据优先,其次公网回显)。
IP=$(curl -fsS -m 3 http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null || true)
[ -z "$IP" ] && IP=$(curl -fsS -m 4 https://myip.ipip.net 2>/dev/null | grep -oE "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" | head -1 || true)
[ -z "$IP" ] && IP="<服务器公网IP>"

PORT="${HTTP_PORT:-80}"
URL="http://$IP"; [ "$PORT" != "80" ] && URL="http://$IP:$PORT"

echo ""
echo "✓ Novaryns 已启动 / started."
echo "  打开  $URL  完成首启配置(填 OpenAI API Key 即可用)。"
echo "  ⚠ 首次需在云厂商「安全组」放行 $PORT 端口,否则浏览器打不开。"
echo ""
echo "  ⚠ 大陆服务器还需在配置里设 OPENAI_BASE_URL 中转,详见 README「中国大陆服务器部署」。"
echo "  不知道 API Key 怎么获取?联系作者微信 xingze063。"
