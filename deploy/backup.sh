#!/usr/bin/env sh
# 每日备份：在仓库根目录执行，配合 cron 使用。
# 0 4 * * * cd /srv/getsleep && sh deploy/backup.sh >> backups/backup.log 2>&1
set -eu

cd "$(dirname "$0")/.."

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p backups
TMP="backups/.sleep-$STAMP.sql"
OUT="backups/sleep-$STAMP.sql.gz"

cleanup() {
  rm -f "$TMP"
}
trap cleanup EXIT INT TERM

# 从 .env 读取库名/用户（不 source，避免把密码带进环境）
DB_NAME="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- || true)"
DB_USER="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- || true)"
DB_NAME="${DB_NAME:-sleep}"
DB_USER="${DB_USER:-sleep}"

# 先落原始 SQL 再压缩，不要写成 `pg_dump | gzip > x.gz`：
# sh 没有 pipefail，管道退出码取 gzip，pg_dump 失败时仍会留下空包并打印 backup ok。
docker compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" > "$TMP"

# 两道最低完整性校验：非空 + 有 pg_dump 结束标记。
# 只有“看起来成功”的备份比没有备份更危险（大改数据库前会误以为有退路）。
[ -s "$TMP" ] || { echo "backup failed: empty dump" >&2; exit 1; }
grep -q 'PostgreSQL database dump complete' "$TMP" \
  || { echo "backup failed: incomplete dump" >&2; exit 1; }

gzip -c "$TMP" > "$OUT"
rm -f "$TMP"

# 只保留 14 天
find backups -name 'sleep-*.sql.gz' -type f -mtime +14 -delete

echo "backup ok: $OUT ($(wc -c < "$OUT") bytes)"
