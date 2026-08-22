#!/usr/bin/env bash
# Dev/test Postgres: wit shares linker's scratch instance on port 5433
# (one local cluster, one database per project). Starts it if down and
# ensures the wit database exists.
# Usage: scripts/dev-db.sh start|stop|url
set -euo pipefail

DIR="${TMPDIR:-/tmp}/linker-pg"
PORT=5433
URL="postgres://linker@localhost:${PORT}/wit"

case "${1:-start}" in
  start)
    if [ ! -d "$DIR" ]; then
      initdb -D "$DIR" -U linker --auth=trust >/dev/null
    fi
    pg_ctl -D "$DIR" status >/dev/null 2>&1 ||
      pg_ctl -D "$DIR" -o "-p $PORT -c unix_socket_directories='$DIR'" -l "$DIR/log" start
    createdb -h localhost -p "$PORT" -U linker wit 2>/dev/null || true
    echo "$URL"
    ;;
  stop)
    pg_ctl -D "$DIR" stop
    ;;
  url)
    echo "$URL"
    ;;
esac
