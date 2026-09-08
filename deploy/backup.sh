#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${DATABASE_BACKUP_URL:?请配置备份数据库地址}"
: "${RESTIC_REPOSITORY:?请配置异地备份仓库}"
: "${RESTIC_PASSWORD_FILE:?请配置备份密钥文件}"
: "${BACKUP_DIR:?请配置本地备份目录}"
mkdir -p "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/backup.lock"
flock -n 9 || exit 0
task_dir=$(mktemp -d "$BACKUP_DIR/snapshot.XXXXXXXX")
pg_dump --dbname="$DATABASE_BACKUP_URL" --format=custom --file="$task_dir/sm.dump"
pg_restore --list "$task_dir/sm.dump" > "$task_dir/manifest.txt"
restic --limit-upload 128 backup "$task_dir" --tag sm-postgres
date -u +%FT%TZ > "$BACKUP_DIR/last-success"
restic forget --tag sm-postgres --group-by host,tags --keep-within 2d --keep-daily 14 --keep-weekly 8
printf '备份完成：%s\n' "$task_dir"
# 清理本次生成的本地副本，远端保留由 restic 管理。
case "$task_dir" in
  "$BACKUP_DIR"/snapshot.*) rm -rf -- "$task_dir" ;;
  *) printf '本地目录不符合预期，保留待检查。\n' >&2; exit 1 ;;
esac
