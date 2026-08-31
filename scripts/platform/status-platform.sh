#!/usr/bin/env bash
# =============================================================================
# scripts/platform/status-platform.sh
#
# Shows the health of all Memory Benchmarks platform components.
# =============================================================================

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Memory Benchmarks Platform — Status"
echo "══════════════════════════════════════════════════════════"
echo ""

ok()   { echo "  ✓  $1"; }
fail() { echo "  ✗  $1"; }
warn() { echo "  ⚠  $1"; }

# ── tmux sessions ──────────────────────────────────────────────────────────
echo "── tmux sessions ─────────────────────────────────────────"
for SESSION in memory-benchmarks mem0-db2 mem0-qdrant; do
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    ok "$SESSION (running)"
  else
    fail "$SESSION (not running)"
  fi
done
echo ""

# ── HTTP health checks ──────────────────────────────────────────────────────
echo "── HTTP health ───────────────────────────────────────────"
check_http() {
  local label="$1" url="$2"
  RESP=$(curl -sf --max-time 3 "$url" 2>/dev/null) || true
  if [[ -n "$RESP" ]]; then
    ok "$label → $url"
    echo "     ${RESP:0:100}"
  else
    fail "$label → $url (no response)"
  fi
}
check_http "Frontend          " "http://localhost:3000/api/templates"
check_http "mem0 Db2 (:8888)  " "http://localhost:8888/health"
check_http "mem0 Qdrant (:8889)" "http://localhost:8889/health"
echo ""

# ── Ollama ──────────────────────────────────────────────────────────────────
echo "── Ollama ────────────────────────────────────────────────"
OLLAMA_TAGS=$(curl -sf --max-time 3 "http://localhost:11434/api/tags" 2>/dev/null) || true
if [[ -n "$OLLAMA_TAGS" ]]; then
  ok "Ollama running at :11434"
  MODELS=$(echo "$OLLAMA_TAGS" | python3 -c "import json,sys; [print('     '+m['name']) for m in json.load(sys.stdin).get('models',[])]" 2>/dev/null || true)
  echo "$MODELS"
else
  fail "Ollama not reachable at :11434"
  echo "     Start with: OLLAMA_HOST=0.0.0.0 ollama serve"
fi
echo ""

# ── Qdrant ──────────────────────────────────────────────────────────────────
echo "── Qdrant ────────────────────────────────────────────────"
if curl -sf --max-time 3 "http://localhost:6333/healthz" -o /dev/null 2>/dev/null || \
   curl -sf --max-time 3 "http://localhost:6333/health"  -o /dev/null 2>/dev/null; then
  ok "Qdrant running at :6333"
else
  warn "Qdrant not reachable at :6333 (needed for Run B)"
  echo "     Start with: docker run -d --name qdrant -p 6333:6333 qdrant/qdrant"
  echo "     Or:         docker start qdrant"
fi
echo ""

# ── Ports summary ───────────────────────────────────────────────────────────
echo "── Port usage ────────────────────────────────────────────"
for PORT in 3000 8888 8889 11434 6333; do
  PROCS=$(lsof -ti :"$PORT" 2>/dev/null | head -3 || true)
  if [[ -n "$PROCS" ]]; then
    ok "Port $PORT in use (PID: $PROCS)"
  else
    echo "  —  Port $PORT not in use"
  fi
done
echo ""

# ── Recent benchmark activity ───────────────────────────────────────────────
BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -f "${BENCH_DIR}/evals.db" ]]; then
  echo "── Recent runs (evals.db) ───────────────────────────────"
  python3 -c "
import sqlite3, os
db_path = os.path.join('${BENCH_DIR}', 'evals.db')
con = sqlite3.connect(db_path)
rows = con.execute('''
  SELECT project_name, status, started_at, finished_at
  FROM eval_runs ORDER BY created_at DESC LIMIT 8
''').fetchall()
for r in rows:
    status_icon = '✓' if r[1] == 'succeeded' else ('▶' if r[1] == 'running' else '✗')
    print(f'  {status_icon}  {r[0][:40]:<40}  {r[1]:<10}  {(r[2] or \"-\")[:16]}')
con.close()
" 2>/dev/null || echo "  (could not read evals.db)"
fi
echo ""
