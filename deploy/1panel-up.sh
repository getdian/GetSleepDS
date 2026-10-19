#!/usr/bin/env bash
set -euo pipefail

# 在解压后的项目根目录执行：bash deploy/1panel-up.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "缺少 .env：先复制 .env.example 为 .env 并填写生产值" >&2
  exit 1
fi

need() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d= -f2- || true)"
  if [ -z "$value" ] || [[ "$value" == change_me* ]]; then
    echo ".env 缺少有效值：$key" >&2
    exit 1
  fi
}

need POSTGRES_PASSWORD
need WX_APPID
need WX_SECRET
need ADMIN_PASSWORD
need CONFIG_SECRET

if ! grep -qE '^TRUST_PROXY=1' .env; then
  echo "警告：建议在 1Panel 反代后设置 TRUST_PROXY=1，否则 IP 限流失效" >&2
fi

HOST_PORT="$(grep -E "^HOST_PORT=" .env | tail -n 1 | cut -d= -f2- || true)"
HOST_PORT="${HOST_PORT:-3000}"

echo "[1panel] docker compose up -d --build"
docker compose up -d --build

echo "[1panel] 等待 /api/ready (端口 ${HOST_PORT}) ..."
ready=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/api/ready" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "API 未就绪；查看：docker compose logs --tail=200 api" >&2
  docker compose ps >&2 || true
  exit 1
fi

echo "[1panel] API ready"
docker compose ps
echo
echo "下一步在 1Panel 建站："
echo "  域名：sleep.qfmaster.com"
echo "  反向代理：http://127.0.0.1:${HOST_PORT}"
echo "  HTTPS：Let's Encrypt + 强制 HTTPS"
echo "  配置加 client_max_body_size 30m"
echo "  只放行 80/443，不要对公网开放 ${HOST_PORT}"
