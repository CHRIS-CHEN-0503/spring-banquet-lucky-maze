#!/usr/bin/env bash
set -euo pipefail

guard_dir="/Users/chenziwei/.codex/skills/process-guard/scripts"
project_dir="/Users/chenziwei/Desktop/自製程式工具/春酒尋籤迷宮"
process_name="spring-maze-load"

cleanup() {
  bash "$guard_dir/stop-managed-process.sh" --name "$process_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

bash "$guard_dir/start-managed-process.sh" \
  --name "$process_name" \
  --command 'tail -f /dev/null | npx wrangler dev --local --port 8788 --var ADMIN_PIN:local-load-only' \
  --port 8788 \
  --health-url http://127.0.0.1:8788/api/health \
  --timeout 45 \
  --cwd "$project_dir"

CLIENTS="${CLIENTS:-60}" \
DURATION_MS="${DURATION_MS:-15000}" \
WS_URL="ws://127.0.0.1:8788/ws/load-test-$(date +%s)" \
node "$project_dir/tools/load-test.mjs"
