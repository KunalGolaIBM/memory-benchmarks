#!/usr/bin/env bash
# ============================================================
# compare.sh — runs all three LOCOMO comparison scenarios and
#              prints a side-by-side accuracy table when done.
#
# The three runs answer three research questions:
#
#   Run A: mem0 + Db2     + llama3.2  (your primary setup)
#   Run B: mem0 + Qdrant  + llama3.2  (swap DB only → proves Db2 is competitive)
#   Run C: NO mem0 at all + llama3.2  (bare LLM    → proves memory helps)
#
# Each run is independent: it starts its own mem0 server on a
# separate port, runs the benchmark, then tears the server down.
# All three share the same answerer + judge (llama3.2 via Ollama).
#
# Usage:
#   chmod +x compare.sh
#   ./compare.sh              # smoke: conv 0, 10 questions per run (~30 min total)
#   ./compare.sh full         # full:  all 10 conversations        (~105 h total)
#   ./compare.sh smoke A      # run only scenario A
#   ./compare.sh smoke B      # run only scenario B
#   ./compare.sh smoke C      # run only scenario C
#   ./compare.sh results      # just print the comparison table from existing results
#
# Prerequisites (must be running before you start):
#   1. Ollama:   OLLAMA_HOST=0.0.0.0 ollama serve
#   2. Db2:      podman start db2server && sleep 60
#   3. Qdrant:   docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
#                  (or: docker start qdrant)
# ============================================================

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
BENCH_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PYTHON="/opt/homebrew/bin/python3.11"
LOG_DIR="/tmp/mem0-compare"
RESULTS_BASE="${BENCH_DIR}/results/locomo"

# ── Args ──────────────────────────────────────────────────────────────────────
MODE="${1:-smoke}"        # smoke | full | results
ONLY_RUN="${2:-ALL}"      # ALL | A | B | C

# ── Benchmark scope ───────────────────────────────────────────────────────────
if [[ "$MODE" == "full" ]]; then
  CONVS="0,1,2,3,4,5,6,7,8,9"
  MAX_Q_FLAG=""
  TAG="full"
else
  CONVS="0"
  MAX_Q_FLAG="--max-questions 10"
  TAG="smoke"
fi

# ── LLM config (same for all three runs) ─────────────────────────────────────
OLLAMA_URL="http://0.0.0.0:11434"
LLM_ARGS=(
  --provider openai
  --base-url "${OLLAMA_URL}/v1"
  --api-key ollama
  --answerer-model llama3.2
  --judge-model llama3.2
  --judge-provider openai
  --judge-base-url "${OLLAMA_URL}/v1"
  --judge-api-key ollama
  --top-k 200
  --top-k-cutoffs "10,20,50,200"
  --conversations "$CONVS"
  --max-workers 2
  --output-dir "$RESULTS_BASE"
  --resume
)
[[ -n "$MAX_Q_FLAG" ]] && LLM_ARGS+=(--max-questions 10)

mkdir -p "$LOG_DIR"

# ── Helper: wait for health ───────────────────────────────────────────────────
wait_healthy() {
  local url="$1" label="$2"
  echo -n "  Waiting for ${label}"
  for i in $(seq 1 40); do
    sleep 2
    if curl -sf "${url}/health" -o /dev/null 2>/dev/null; then
      echo " ✓"
      return 0
    fi
    echo -n "."
  done
  echo " TIMEOUT"
  return 1
}

# ── Helper: start mem0 server ─────────────────────────────────────────────────
start_mem0() {
  local config="$1" port="$2" history_dir="$3" label="$4"
  echo ""
  echo "▶  Starting mem0 server [${label}] on :${port} ..."
  mkdir -p "$history_dir"
  MEM0_CONFIG_PATH="${BENCH_DIR}/${config}" \
  HISTORY_DB_PATH="${history_dir}/history.db" \
  PYTHONPATH="${BENCH_DIR}/docker/mem0" \
  "$PYTHON" -m uvicorn main:app \
    --app-dir "${BENCH_DIR}/docker/mem0" \
    --host 0.0.0.0 \
    --port "$port" \
    --log-level info \
    > "${LOG_DIR}/mem0-${label}.log" 2>&1 &
  echo "$!"   # return PID
}

# ── Helper: stop mem0 server ──────────────────────────────────────────────────
stop_mem0() {
  local pid="$1" port="$2" label="$3"
  echo "  Stopping mem0 server [${label}] (PID $pid) ..."
  kill "$pid" 2>/dev/null || true
  # belt-and-suspenders: free the port
  lsof -ti :"$port" | xargs kill -9 2>/dev/null || true
  sleep 2
}

# ── Helper: run one benchmark scenario ───────────────────────────────────────
run_scenario() {
  local label="$1" project="$2" mem0_host="$3" no_memory="${4:-false}"
  local log_file="${LOG_DIR}/bench-${label}.log"

  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  Running scenario ${label}: ${project}"
  echo "════════════════════════════════════════════════════════"

  local extra_args=()
  if [[ "$no_memory" == "true" ]]; then
    extra_args=(--no-memory)
  else
    extra_args=(--backend oss --mem0-host "$mem0_host")
  fi

  "$PYTHON" -m benchmarks.locomo.run \
    --project-name "$project" \
    "${LLM_ARGS[@]}" \
    "${extra_args[@]}" \
    > "$log_file" 2>&1

  echo "  ✓ ${label} complete — log: ${log_file}"
}

# ── Print comparison table ────────────────────────────────────────────────────
print_table() {
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  COMPARISON RESULTS"
  echo "════════════════════════════════════════════════════════"
  "$PYTHON" - <<'PYEOF'
import json, os, sys, glob

results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "locomo")

def load_latest(project_name):
    pattern = os.path.join(results_dir, "locomo_results_*.json")
    files = sorted(glob.glob(pattern), reverse=True)
    for f in files:
        try:
            d = json.loads(open(f).read())
            meta = d.get("metadata", {})
            if meta.get("project_name", "").startswith(project_name):
                return d
        except Exception:
            continue
    return None

scenarios = [
    ("A", "compare-db2",     "mem0 + Db2    + llama3.2"),
    ("B", "compare-qdrant",  "mem0 + Qdrant + llama3.2"),
    ("C", "compare-nomem",   "NO memory     + llama3.2"),
]

rows = []
for key, proj, label in scenarios:
    d = load_latest(proj)
    if d is None:
        rows.append((key, label, "—", "—", "—", "—", "—"))
        continue
    m50 = d.get("metrics_by_cutoff", {}).get("top_50", {}).get("overall", {})
    by_cat = d.get("metrics_by_cutoff", {}).get("top_50", {}).get("by_category", {})
    acc  = f"{m50.get('accuracy', 0):.1f}%"
    tot  = str(m50.get("total", 0))
    cats = {k: f"{v.get('accuracy',0):.1f}%" for k, v in by_cat.items()}
    rows.append((key, label, acc, tot,
                 cats.get("single-hop",     cats.get("single_hop", "—")),
                 cats.get("multi-hop",      cats.get("multi_hop",  "—")),
                 cats.get("temporal",                               "—"),
                 cats.get("open-domain",    cats.get("open_domain","—"))))

# header
print(f"\n{'Run':<4} {'Setup':<35} {'Acc@50':>7} {'Qs':>5}  {'Single':>7} {'Multi':>7} {'Temporal':>9} {'Open':>7}")
print("─" * 90)
for r in rows:
    key, label, acc, tot = r[0], r[1], r[2], r[3]
    cats = r[4:]
    cat_str = "  ".join(f"{c:>7}" for c in cats[:4])
    print(f"{key:<4} {label:<35} {acc:>7} {tot:>5}  {cat_str}")
print()

# delta analysis
if len(rows) >= 2:
    def pct(s):
        try: return float(s.replace("%",""))
        except: return None

    a_acc = pct(rows[0][2])
    b_acc = pct(rows[1][2]) if len(rows) > 1 else None
    c_acc = pct(rows[2][2]) if len(rows) > 2 else None

    print("Key findings:")
    if a_acc is not None and c_acc is not None:
        delta = a_acc - c_acc
        sign = "+" if delta >= 0 else ""
        print(f"  Memory gain   (A vs C): {sign}{delta:.1f}pp  — {'memory HELPS' if delta > 0 else 'memory does NOT help at this scale'}")
    if a_acc is not None and b_acc is not None:
        delta = a_acc - b_acc
        sign = "+" if delta >= 0 else ""
        print(f"  Db2 vs Qdrant (A vs B): {sign}{delta:.1f}pp  — {'Db2 BETTER' if delta > 0 else ('tied' if abs(delta) < 1 else 'Qdrant better')}")
PYEOF
}

# ──────────────────────────────────────────────────────────────────────────────
# "results" mode — just print table from whatever is on disk
# ──────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "results" ]]; then
  print_table
  exit 0
fi

# ──────────────────────────────────────────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
echo "  mem0 Comparison Benchmark  (mode: ${MODE}, runs: ${ONLY_RUN})"
echo "════════════════════════════════════════════════════════"

# Ollama
if ! curl -sf "${OLLAMA_URL}/api/tags" -o /dev/null; then
  echo "ERROR: Ollama is not running. Start with: OLLAMA_HOST=0.0.0.0 ollama serve"; exit 1
fi
MODELS=$(curl -sf "${OLLAMA_URL}/api/tags" | "$PYTHON" -c \
  "import json,sys; print(' '.join(m['name'] for m in json.load(sys.stdin).get('models',[])))")
for M in "llama3.2" "nomic-embed-text"; do
  if ! echo "$MODELS" | grep -q "$M"; then
    echo "ERROR: Ollama model '$M' not found. Run: ollama pull $M"; exit 1
  fi
done
echo "✓ Ollama — llama3.2 and nomic-embed-text available"

# Db2 (only needed for run A)
if [[ "$ONLY_RUN" == "ALL" || "$ONLY_RUN" == "A" ]]; then
  if ! "$PYTHON" -c "
import ibm_db_dbi
c = ibm_db_dbi.connect('DATABASE=TESTDB;HOSTNAME=127.0.0.1;PORT=50000;PROTOCOL=TCPIP;UID=db2inst1;PWD=pass;Authentication=SERVER;','','')
c.close()
print('ok')
" 2>/dev/null | grep -q ok; then
    echo "ERROR: IBM Db2 not reachable at 127.0.0.1:50000 (needed for Run A)"
    echo "  Start: podman start db2server && sleep 60"
    exit 1
  fi
  echo "✓ Db2 — TESTDB at 127.0.0.1:50000"
fi

# Qdrant (only needed for run B)
if [[ "$ONLY_RUN" == "ALL" || "$ONLY_RUN" == "B" ]]; then
  if ! curl -sf "http://localhost:6333/healthz" -o /dev/null 2>/dev/null && \
     ! curl -sf "http://localhost:6333/health"  -o /dev/null 2>/dev/null; then
    echo "ERROR: Qdrant not reachable at localhost:6333 (needed for Run B)"
    echo "  Start: docker run -d --name qdrant -p 6333:6333 qdrant/qdrant"
    echo "  Or:    docker start qdrant"
    exit 1
  fi
  echo "✓ Qdrant — localhost:6333"
fi

cd "$BENCH_DIR"

# ──────────────────────────────────────────────────────────────────────────────
# RUN A — mem0 + Db2 + llama3.2  (port 8888)
# ──────────────────────────────────────────────────────────────────────────────
if [[ "$ONLY_RUN" == "ALL" || "$ONLY_RUN" == "A" ]]; then
  MEM0_PID=$(start_mem0 "mem0-config.yaml" 8888 "/tmp/mem0-compare-db2" "db2")
  wait_healthy "http://localhost:8888" "db2-mem0"
  run_scenario "A" "compare-db2-${TAG}" "http://localhost:8888" "false"
  stop_mem0 "$MEM0_PID" 8888 "db2"
fi

# ──────────────────────────────────────────────────────────────────────────────
# RUN B — mem0 + Qdrant + llama3.2  (port 8889)
# ──────────────────────────────────────────────────────────────────────────────
if [[ "$ONLY_RUN" == "ALL" || "$ONLY_RUN" == "B" ]]; then
  MEM0_PID=$(start_mem0 "mem0-config-qdrant.yaml" 8889 "/tmp/mem0-compare-qdrant" "qdrant")
  wait_healthy "http://localhost:8889" "qdrant-mem0"
  run_scenario "B" "compare-qdrant-${TAG}" "http://localhost:8889" "false"
  stop_mem0 "$MEM0_PID" 8889 "qdrant"
fi

# ──────────────────────────────────────────────────────────────────────────────
# RUN C — NO mem0, bare llama3.2  (no server needed)
# ──────────────────────────────────────────────────────────────────────────────
if [[ "$ONLY_RUN" == "ALL" || "$ONLY_RUN" == "C" ]]; then
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  Run C: NO-MEMORY baseline (no mem0 server needed)"
  echo "════════════════════════════════════════════════════════"
  run_scenario "C" "compare-nomem-${TAG}" "" "true"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Import all three results into evals.db for the UI dashboard
# ──────────────────────────────────────────────────────────────────────────────
echo ""
echo "Importing results into dashboard (evals.db) ..."
NODE="/Users/kunalgola/.nvm/versions/node/v22.23.2/bin/node"
for proj in "compare-db2-${TAG}" "compare-qdrant-${TAG}" "compare-nomem-${TAG}"; do
  RESULT=$(ls -t "${RESULTS_BASE}"/locomo_results_*.json 2>/dev/null | \
    xargs grep -l "\"project_name\": \"${proj}\"" 2>/dev/null | head -1 || true)
  if [[ -n "$RESULT" ]]; then
    "$NODE" "${BENCH_DIR}/scripts/import-result.mjs" "$RESULT" && \
      echo "  ✓ imported: $RESULT" || \
      echo "  ✗ import failed for $RESULT"
  fi
done

# ──────────────────────────────────────────────────────────────────────────────
# Print the comparison table
# ──────────────────────────────────────────────────────────────────────────────
print_table

echo ""
echo "All logs in: ${LOG_DIR}/"
echo "Open the dashboard to see full details: open http://localhost:3000"
