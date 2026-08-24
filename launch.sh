#!/usr/bin/env bash
# ============================================================
# launch.sh — one-command starter for the mem0 benchmark stack
#
# Opens FOUR iTerm/Terminal split panes (or plain bg processes):
#   1. mem0  server  → http://localhost:8888
#   2. Dashboard UI  → http://localhost:3000
#   3. LOCOMO smoke  → 1 conversation, 10 questions (~10 min)
#   4. Log tail
#
# Usage:
#   chmod +x launch.sh
#   ./launch.sh              # smoke test (quick, ~10 min)
#   ./launch.sh full         # full run  (all 10 convs, ~35h)
#   ./launch.sh stop         # kill everything
#
# All logs land in /tmp/mem0-bench/
# ============================================================

set -euo pipefail

# ── Paths ────────────────────────────────────────────────────────────────────
BENCH_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
MEM0_DIR="/Users/kunalgola/Projects/Personal/mem0"
PYTHON="/opt/homebrew/bin/python3.11"
NODE="/Users/kunalgola/.nvm/versions/node/v22.23.2/bin/node"
NPM="/Users/kunalgola/.nvm/versions/node/v22.23.2/bin/npm"
LOG_DIR="/tmp/mem0-bench"

# ── Ports ────────────────────────────────────────────────────────────────────
MEM0_PORT=8888
UI_PORT=3000
OLLAMA_URL="http://0.0.0.0:11434"
MEM0_URL="http://127.0.0.1:${MEM0_PORT}"

# ── Benchmark settings (smoke = fast, full = real) ───────────────────────────
MODE="${1:-smoke}"

# ── Stop ─────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "stop" ]]; then
  echo "Stopping all benchmark processes..."
  lsof -ti :${MEM0_PORT} | xargs kill -9 2>/dev/null || true
  lsof -ti :${UI_PORT}   | xargs kill -9 2>/dev/null || true
  # kill any running locomo/longmemeval/beam python processes
  pkill -f "benchmarks.locomo.run"   2>/dev/null || true
  pkill -f "benchmarks.longmemeval"  2>/dev/null || true
  pkill -f "benchmarks.beam.run"     2>/dev/null || true
  echo "Done. Ports ${MEM0_PORT} and ${UI_PORT} are free."
  exit 0
fi

# ── Pre-flight checks ─────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
echo "  mem0 Benchmark Launcher  (mode: ${MODE})"
echo "════════════════════════════════════════════════════════"

# Python
if ! "$PYTHON" --version &>/dev/null; then
  echo "ERROR: Python not found at $PYTHON"; exit 1
fi

# Node 22
if ! "$NODE" --version &>/dev/null; then
  echo "ERROR: Node 22 not found at $NODE"
  echo "  Run: source ~/.nvm/nvm.sh && nvm install 22"
  exit 1
fi

# Ollama
if ! curl -sf "${OLLAMA_URL}/api/tags" -o /dev/null; then
  echo "ERROR: Ollama is not running."
  echo "  Start it with: OLLAMA_HOST=0.0.0.0 ollama serve"
  exit 1
fi
MODELS=$(curl -sf "${OLLAMA_URL}/api/tags" | python3.11 -c \
  "import json,sys; print(' '.join(m['name'] for m in json.load(sys.stdin).get('models',[])))")
for M in "llama3.2" "nomic-embed-text"; do
  if ! echo "$MODELS" | grep -q "$M"; then
    echo "ERROR: Ollama model '$M' not found. Run: ollama pull $M"; exit 1
  fi
done
echo "✓ Ollama  — llama3.2 and nomic-embed-text available"

# Db2
if ! "$PYTHON" -c "
import ibm_db_dbi
c = ibm_db_dbi.connect(
  'DATABASE=TESTDB;HOSTNAME=127.0.0.1;PORT=50000;PROTOCOL=TCPIP;UID=db2inst1;PWD=pass;Authentication=SERVER;',
  '','')
c.close()
print('ok')
" 2>/dev/null | grep -q ok; then
  echo "ERROR: IBM Db2 is not reachable at 127.0.0.1:50000"
  echo "  Start it: podman start db2server && sleep 60"
  exit 1
fi
echo "✓ Db2     — TESTDB at 127.0.0.1:50000"

# Ports free
for PORT in $MEM0_PORT $UI_PORT; do
  if lsof -ti :"$PORT" &>/dev/null; then
    echo "ERROR: port $PORT is already in use."
    echo "  Run: ./launch.sh stop    to kill previous session"
    exit 1
  fi
done
echo "✓ Ports   — ${MEM0_PORT} and ${UI_PORT} are free"
echo ""

# ── Create log dir ────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR" /tmp/mem0-history
cd "$BENCH_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Start mem0 server
# ─────────────────────────────────────────────────────────────────────────────
echo "Starting mem0 server on :${MEM0_PORT} ..."
MEM0_CONFIG_PATH="${BENCH_DIR}/mem0-config.yaml" \
HISTORY_DB_PATH="/tmp/mem0-history/history.db" \
PYTHONPATH="${BENCH_DIR}/docker/mem0" \
"$PYTHON" -m uvicorn main:app \
  --app-dir "${BENCH_DIR}/docker/mem0" \
  --host 0.0.0.0 \
  --port "$MEM0_PORT" \
  --log-level info \
  > "$LOG_DIR/mem0-server.log" 2>&1 &
MEM0_PID=$!
echo "  PID $MEM0_PID  →  tail -f $LOG_DIR/mem0-server.log"

# Wait for it to be healthy
echo -n "  Waiting for /health"
for i in $(seq 1 30); do
  sleep 1
  if curl -sf "${MEM0_URL}/health" -o /dev/null 2>/dev/null; then
    echo " ✓"
    break
  fi
  echo -n "."
  if [[ $i -eq 30 ]]; then
    echo " TIMEOUT"
    echo "Server log:"; tail -20 "$LOG_DIR/mem0-server.log"; exit 1
  fi
done

HEALTH=$(curl -s "${MEM0_URL}/health")
echo "  Health: $HEALTH"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Start dashboard UI
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "Starting dashboard UI on :${UI_PORT} ..."

# Always rebuild so new API routes (results, logs) are included
echo "  Building Next.js app..."
cd "$BENCH_DIR"
PATH="${BENCH_DIR}/node_modules/.bin:$(dirname "$NODE"):$PATH" \
  "$NPM" run build > "$LOG_DIR/ui-build.log" 2>&1 || {
  echo "  Build failed — see $LOG_DIR/ui-build.log"
  tail -20 "$LOG_DIR/ui-build.log"
  exit 1
}

NODE_PATH="${BENCH_DIR}/node_modules" \
"$NODE" "${BENCH_DIR}/node_modules/.bin/next" start \
  --port "$UI_PORT" \
  > "$LOG_DIR/ui.log" 2>&1 &
UI_PID=$!
echo "  PID $UI_PID  →  tail -f $LOG_DIR/ui.log"

echo -n "  Waiting for UI"
for i in $(seq 1 30); do
  sleep 1
  if curl -sf "http://localhost:${UI_PORT}/" -o /dev/null 2>/dev/null; then
    echo " ✓"
    break
  fi
  echo -n "."
  if [[ $i -eq 30 ]]; then
    echo " TIMEOUT — check $LOG_DIR/ui.log"
    tail -10 "$LOG_DIR/ui.log"
    exit 1
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# 3. Register the benchmark run in the UI database via POST /api/runs
#    This makes it appear on the dashboard homepage immediately.
# ─────────────────────────────────────────────────────────────────────────────
echo ""
if [[ "$MODE" == "smoke" ]]; then
  CONVS="0"
  MAX_Q_ARG=',"max_questions":10'
  PROJ="db2-smoke-$(date +%H%M)"
  LABEL="LOCOMO smoke test (conv 0, 10 questions — ~10 min)"
else
  CONVS="0,1,2,3,4,5,6,7,8,9"
  MAX_Q_ARG=""
  PROJ="db2-llama32-locomo-$(date +%Y%m%d)"
  LABEL="LOCOMO full run (10 convs — ~35 h)"
fi

echo "Registering run '$PROJ' in the dashboard..."
RUN_RESPONSE=$(curl -sf -X POST "http://localhost:${UI_PORT}/api/runs" \
  -H "Content-Type: application/json" \
  -d "{
    \"template_id\": \"locomo\",
    \"project_name\": \"${PROJ}\",
    \"config\": {
      \"backend\": \"oss\",
      \"mem0_host\": \"${MEM0_URL}\",
      \"provider\": \"openai\",
      \"base_url\": \"${OLLAMA_URL}/v1\",
      \"api_key\": \"ollama\",
      \"answerer_model\": \"llama3.2\",
      \"judge_model\": \"llama3.2\",
      \"judge_provider\": \"openai\",
      \"top_k\": 200,
      \"top_k_cutoffs\": \"10,20,50,200\",
      \"conversations\": \"${CONVS}\",
      \"max_workers\": 4,
      \"output_dir\": \"results/locomo\",
      \"resume\": true,
      \"debug\": true${MAX_Q_ARG}
    },
    \"env_overrides\": {}
  }" 2>&1) || {
  echo "  WARNING: Could not register run in dashboard (UI may still be starting)"
  echo "  Run will still execute — import manually with:"
  echo "    $NODE scripts/import-result.mjs <result-json>"
  RUN_RESPONSE=""
}

RUN_ID=$(echo "$RUN_RESPONSE" | python3.11 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || true)
if [[ -n "$RUN_ID" ]]; then
  echo "  ✓ Run registered: http://localhost:${UI_PORT}/runs/${RUN_ID}"
  LOCOMO_LOG="${BENCH_DIR}/logs/${RUN_ID}.log"
else
  echo "  (falling back to direct Python launch)"
  LOCOMO_LOG="$LOG_DIR/locomo.log"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. If UI registration succeeded the executor already started the process.
#    If it failed (no RUN_ID), fall back to direct Python launch.
# ─────────────────────────────────────────────────────────────────────────────
if [[ -z "$RUN_ID" ]]; then
  echo ""
  echo "Starting $LABEL (direct launch) ..."
  cd "$BENCH_DIR"
  MAX_Q_FLAG=""
  [[ "$MODE" == "smoke" ]] && MAX_Q_FLAG="--max-questions 10"
  "$PYTHON" -m benchmarks.locomo.run \
    --project-name "$PROJ" \
    --backend oss \
    --mem0-host "$MEM0_URL" \
    --provider openai \
    --base-url "${OLLAMA_URL}/v1" \
    --api-key "ollama" \
    --answerer-model "llama3.2" \
    --judge-model "llama3.2" \
    --top-k 200 \
    --top-k-cutoffs "10,20,50,200" \
    --conversations "$CONVS" \
    --max-workers 4 \
    --output-dir results/locomo \
    --resume \
    --debug \
    $MAX_Q_FLAG \
    > "$LOCOMO_LOG" 2>&1 &
  LOCOMO_PID=$!
  echo "  PID $LOCOMO_PID  →  tail -f $LOCOMO_LOG"
else
  # Executor spawned the process — find its PID from the log or just report the run URL
  LOCOMO_PID="(managed by UI executor)"
  echo ""
  echo "Starting $LABEL ..."
  echo "  Managed by UI executor  →  tail -f $LOCOMO_LOG"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
echo "  All services running"
echo "════════════════════════════════════════════════════════"
echo ""
echo "  mem0 server  → $MEM0_URL/health   (PID $MEM0_PID)"
echo "  Dashboard UI → http://localhost:${UI_PORT}           (PID $UI_PID)"
if [[ -n "$RUN_ID" ]]; then
echo "  LOCOMO run   → http://localhost:${UI_PORT}/runs/${RUN_ID}"
else
echo "  LOCOMO run   → $LOCOMO_LOG"
fi
echo ""
echo "  Open the dashboard:  open http://localhost:${UI_PORT}"
echo "  Watch the benchmark: tail -f $LOCOMO_LOG"
echo "  Watch mem0 server:   tail -f $LOG_DIR/mem0-server.log"
echo ""
echo "  Stop everything:     ./launch.sh stop"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 6. Live tail of benchmark log (Ctrl-C to detach — processes keep running)
# ─────────────────────────────────────────────────────────────────────────────
echo "Tailing benchmark log (Ctrl-C to detach, services keep running):"
echo "────────────────────────────────────────────────────────"
tail -f "$LOCOMO_LOG"
