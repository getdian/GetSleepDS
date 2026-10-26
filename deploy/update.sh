#!/usr/bin/env bash
set -euo pipefail

# 睡点 · 1Panel 迭代更新脚本
# 执行方式：在项目根目录（/opt/1panel/www/sites/sleepDS/index）执行：bash deploy/update.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[update] 正在基于最新代码重新构建并启动 api 容器..."
docker compose up -d --build --no-deps api

HOST_PORT="$(grep -E "^HOST_PORT=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
HOST_PORT="${HOST_PORT:-3004}"

echo "[update] 等待 API 启动检查 (http://127.0.0.1:${HOST_PORT}/api/ready)..."
ready=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/api/ready" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "[update] 错误：API 未能在 30 秒内就绪，请查看容器日志：" >&2
  echo "  docker compose logs --tail=100 api" >&2
  exit 1
fi

echo "[update] 迭代部署成功！API 服务正常运行中 (端口: ${HOST_PORT})。"
