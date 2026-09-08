#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?请配置新建空数据库的地址}"
: "${BACKUP_DUMP:?请配置待恢复的 sm.dump 路径}"
if [ "${CONFIRM_RESTORE:-}" != "empty-database" ]; then
  printf '请确认目标为空数据库，再设置 CONFIRM_RESTORE=empty-database\n' >&2
  exit 1
fi
existing=$(psql "$RESTORE_DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
if [ "$existing" != "0" ]; then
  printf '目标数据库包含现有表，恢复已停止。\n' >&2
  exit 1
fi
pg_restore --dbname="$RESTORE_DATABASE_URL" --exit-on-error --single-transaction "$BACKUP_DUMP"
printf '数据库恢复完成，请执行健康检查与任务核对。\n'
