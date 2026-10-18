#!/usr/bin/env sh
# 每日备份：在仓库根目录执行，配合 cron 使用。
# 0 4 * * * cd /srv/getsleep && sh deploy/backup.sh >> backups/backup.log 2>&1
set -eu

cd "$(dirname "$0")/.."

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p backups

# 从 .env 读取库名/用户（不 source，避免把密码带进环境）
DB_NAME="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- || true)"
DB_USER="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- || true)"
DB_NAME="${DB_NAME:-sleep}"
DB_USER="${DB_USER:-sleep}"

docker compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "backups/sleep-$STAMP.sql.gz"

# 只保留 14 天
find backups -name 'sleep-*.sql.gz' -type f -mtime +14 -delete

echo "backup ok: backups/sleep-$STAMP.sql.gz"
