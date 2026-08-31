#!/usr/bin/env bash
# =============================================================================
# scripts/platform/start-platform.sh
#
# Starts the complete Memory Benchmarks platform on the Linux AMD64 Fyre VM
# using persistent tmux sessions.
#
# Services started:
#   tmux session "mem0-db2"         → mem0 server :8888 (IBM Db2 backend)
#   tmux session "mem0-qdrant"      → mem0 server :8889 (Qdrant backend)
#   tmux session "memory-benchmarks" → Next.js frontend :3000
#
# Prerequisites:
#   - Ollama running: OLLAMA_HOST=0.0.0.0 ollama serve
#   - IBM Db2 accessible at 9.21.131.70:50000
#   - Docker/Qdrant (for Run B): docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
#   - MEM0_DB2_PASSWORD env set (or enter it when prompted)
#
# Usage:
#   chmod +x scripts/platform/start-platform.sh
#   MEM0_DB2_PASSWORD="yourpassword" ./scripts/platform/start-platform.sh
#   # or: ./scripts/platform/start-platform.sh  (will prompt for password)
# =============================================================================
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="${BENCH_DIR}/logs/platform"
PYTHON="${BENCHMARK_PYTHON:-$(command -v python3.11 2>/dev/null || command -v python3)}"
NODE_BIN="${BENCH_DIR}/node_modules/.bin"

# ── Password handling (never written to disk) ─────────────────────────────────
if [[ -z "${MEM0_DB2_PASSWORD:-}" ]]; then
  read -rsp "Enter Db2 password for user 'gola': " MEM0_DB2_PASSWORD
  echo
fi
export MEM0_DB2_PASSWORD

mkdir -p "$LOG_DIR"

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Memory Benchmarks Platform — Starting"
echo "  Repo: $BENCH_DIR"
echo "══════════════════════════════════════════════════════════"

# ── Helper: create-or-attach tmux session ─────────────────────────────────────
start_tmux_session() {
  local session="$1" cmd="$2"
  if tmux has-session -t "$session" 2>/dev/null; then
    echo "  ✓ tmux session '$session' already running (not restarted)"
    return 0
  fi
  tmux new-session -d -s "$session" -x 220 -y 50
  tmux send-keys -t "$session" "$cmd" Enter
  echo "  ✓ Started tmux session: $session"
  echo "    → tmux attach -t $session"
}

# ── 1. mem0 server — Db2 backend (port 8888) ─────────────────────────────────
echo ""
echo "Starting mem0-db2 (port 8888) ..."
mkdir -p /tmp/mem0-db2-history
MEM0_CMD="MEM0_CONFIG_PATH=${BENCH_DIR}/mem0-config-linux-db2.yaml \
  HISTORY_DB_PATH=/tmp/mem0-db2-history/history.db \
  MEM0_DB2_PASSWORD='${MEM0_DB2_PASSWORD}' \
  PYTHONPATH=${BENCH_DIR}/docker/mem0 \
  ${PYTHON} -m uvicorn main:app \
    --app-dir ${BENCH_DIR}/docker/mem0 \
    --host 0.0.0.0 --port 8888 --log-level info \
    2>&1 | tee ${LOG_DIR}/mem0-db2.log"
start_tmux_session "mem0-db2" "$MEM0_CMD"

# ── 2. mem0 server — Qdrant backend (port 8889) ───────────────────────────────
echo ""
echo "Starting mem0-qdrant (port 8889) ..."
mkdir -p /tmp/mem0-qdrant-history
QDRANT_CMD="MEM0_CONFIG_PATH=${BENCH_DIR}/mem0-config-linux-qdrant.yaml \
  HISTORY_DB_PATH=/tmp/mem0-qdrant-history/history.db \
  PYTHONPATH=${BENCH_DIR}/docker/mem0 \
  ${PYTHON} -m uvicorn main:app \
    --app-dir ${BENCH_DIR}/docker/mem0 \
    --host 0.0.0.0 --port 8889 --log-level info \
    2>&1 | tee ${LOG_DIR}/mem0-qdrant.log"
start_tmux_session "mem0-qdrant" "$QDRANT_CMD"

# Wait for mem0 servers to start
echo -n "  Waiting for mem0 servers"
for i in $(seq 1 30); do
  sleep 2
  DB2_OK=false; QDRANT_OK=false
  curl -sf http://localhost:8888/health -o /dev/null 2>/dev/null && DB2_OK=true
  curl -sf http://localhost:8889/health -o /dev/null 2>/dev/null && QDRANT_OK=true
  if $DB2_OK && $QDRANT_OK; then echo " ✓"; break; fi
  echo -n "."
  if [[ $i -eq 30 ]]; then
    echo ""
    echo "  WARNING: mem0 servers not yet healthy (they may still be starting)"
    echo "    Check: tail -f ${LOG_DIR}/mem0-db2.log"
  fi
done

# ── 3. Next.js frontend + backend (port 3000) ────────────────────────────────
echo ""
echo "Starting memory-benchmarks frontend (port 3000) ..."

# Build if .next does not exist or is stale
if [[ ! -d "${BENCH_DIR}/.next" ]]; then
  echo "  Building Next.js app (first-time) ..."
  cd "$BENCH_DIR"
  PATH="${NODE_BIN}:$PATH" npm run build >> "${LOG_DIR}/ui-build.log" 2>&1 || {
    echo "  ERROR: Next.js build failed — see ${LOG_DIR}/ui-build.log"
    exit 1
  }
fi

UI_CMD="cd ${BENCH_DIR} && \
  BENCHMARK_PYTHON=${PYTHON} \
  PATH=${NODE_BIN}:${PATH} \
  npm run start -- --port 3000 \
  2>&1 | tee ${LOG_DIR}/frontend.log"
start_tmux_session "memory-benchmarks" "$UI_CMD"

sleep 3
UI_READY=false
for i in $(seq 1 20); do
  curl -sf http://localhost:3000/ -o /dev/null 2>/dev/null && UI_READY=true && break
  sleep 1
done

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Platform running"
echo "══════════════════════════════════════════════════════════"
echo ""
echo "  Frontend       → http://localhost:3000"
echo "  mem0 Db2       → http://localhost:8888/health"
echo "  mem0 Qdrant    → http://localhost:8889/health"
echo ""
echo "  Access from browser (replace IP with your VM's external IP):"
echo "  → http://9.21.131.70:3000     (if port 3000 is open)"
echo "  → OR via SSH tunnel:"
echo "     ssh -L 3000:localhost:3000 gola@9.21.131.70"
echo "     then open http://localhost:3000"
echo ""
echo "  tmux sessions:"
echo "  → tmux attach -t memory-benchmarks"
echo "  → tmux attach -t mem0-db2"
echo "  → tmux attach -t mem0-qdrant"
echo ""
echo "  Logs: ${LOG_DIR}/"
echo ""
echo "  Stop everything:   ./scripts/platform/stop-platform.sh"
echo "  Status check:      ./scripts/platform/status-platform.sh"
