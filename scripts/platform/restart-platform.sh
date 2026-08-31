#!/usr/bin/env bash
# =============================================================================
# scripts/platform/restart-platform.sh
#
# Restarts all or specific platform services.
#
# Usage:
#   ./scripts/platform/restart-platform.sh          # restart everything
#   ./scripts/platform/restart-platform.sh frontend  # restart only frontend
#   ./scripts/platform/restart-platform.sh mem0-db2  # restart only mem0-db2
# =============================================================================
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-all}"

if [[ "$TARGET" == "all" ]]; then
  echo "Restarting all platform services..."
  "$BENCH_DIR/scripts/platform/stop-platform.sh"
  sleep 2
  MEM0_DB2_PASSWORD="${MEM0_DB2_PASSWORD:-}" \
    "$BENCH_DIR/scripts/platform/start-platform.sh"
elif [[ "$TARGET" == "mem0-db2" ]]; then
  echo "Restarting mem0-db2 session..."
  tmux kill-session -t mem0-db2 2>/dev/null || true
  lsof -ti :8888 | xargs kill -9 2>/dev/null || true
  sleep 1
  PYTHON="${BENCHMARK_PYTHON:-$(command -v python3.11 2>/dev/null || command -v python3)}"
  mkdir -p /tmp/mem0-db2-history "${BENCH_DIR}/logs/platform"
  LOG="${BENCH_DIR}/logs/platform/mem0-db2.log"
  tmux new-session -d -s mem0-db2
  tmux send-keys -t mem0-db2 "MEM0_CONFIG_PATH=${BENCH_DIR}/mem0-config-linux-db2.yaml \
    HISTORY_DB_PATH=/tmp/mem0-db2-history/history.db \
    MEM0_DB2_PASSWORD='${MEM0_DB2_PASSWORD:-}' \
    PYTHONPATH=${BENCH_DIR}/docker/mem0 \
    ${PYTHON} -m uvicorn main:app \
      --app-dir ${BENCH_DIR}/docker/mem0 \
      --host 0.0.0.0 --port 8888 --log-level info \
      2>&1 | tee ${LOG}" Enter
  echo "  ✓ mem0-db2 restarted — tmux attach -t mem0-db2"
elif [[ "$TARGET" == "mem0-qdrant" ]]; then
  echo "Restarting mem0-qdrant session..."
  tmux kill-session -t mem0-qdrant 2>/dev/null || true
  lsof -ti :8889 | xargs kill -9 2>/dev/null || true
  sleep 1
  PYTHON="${BENCHMARK_PYTHON:-$(command -v python3.11 2>/dev/null || command -v python3)}"
  mkdir -p /tmp/mem0-qdrant-history "${BENCH_DIR}/logs/platform"
  LOG="${BENCH_DIR}/logs/platform/mem0-qdrant.log"
  tmux new-session -d -s mem0-qdrant
  tmux send-keys -t mem0-qdrant "MEM0_CONFIG_PATH=${BENCH_DIR}/mem0-config-linux-qdrant.yaml \
    HISTORY_DB_PATH=/tmp/mem0-qdrant-history/history.db \
    PYTHONPATH=${BENCH_DIR}/docker/mem0 \
    ${PYTHON} -m uvicorn main:app \
      --app-dir ${BENCH_DIR}/docker/mem0 \
      --host 0.0.0.0 --port 8889 --log-level info \
      2>&1 | tee ${LOG}" Enter
  echo "  ✓ mem0-qdrant restarted — tmux attach -t mem0-qdrant"
elif [[ "$TARGET" == "frontend" ]]; then
  echo "Restarting frontend session..."
  tmux kill-session -t memory-benchmarks 2>/dev/null || true
  lsof -ti :3000 | xargs kill -9 2>/dev/null || true
  sleep 1
  PYTHON="${BENCHMARK_PYTHON:-$(command -v python3.11 2>/dev/null || command -v python3)}"
  LOG="${BENCH_DIR}/logs/platform/frontend.log"
  NODE_BIN="${BENCH_DIR}/node_modules/.bin"
  tmux new-session -d -s memory-benchmarks
  tmux send-keys -t memory-benchmarks "cd ${BENCH_DIR} && \
    BENCHMARK_PYTHON=${PYTHON} \
    PATH=${NODE_BIN}:${PATH} \
    npm run start -- --port 3000 2>&1 | tee ${LOG}" Enter
  echo "  ✓ frontend restarted — tmux attach -t memory-benchmarks"
else
  echo "Unknown target: $TARGET"
  echo "Usage: $0 [all|mem0-db2|mem0-qdrant|frontend]"
  exit 1
fi
