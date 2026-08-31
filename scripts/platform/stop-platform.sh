#!/usr/bin/env bash
# =============================================================================
# scripts/platform/stop-platform.sh
#
# Gracefully stops all Memory Benchmarks platform processes.
# Kills tmux sessions and frees ports.
# =============================================================================
set -euo pipefail

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Memory Benchmarks Platform — Stopping"
echo "══════════════════════════════════════════════════════════"
echo ""

stop_session() {
  local session="$1"
  if tmux has-session -t "$session" 2>/dev/null; then
    tmux kill-session -t "$session"
    echo "  ✓ Killed tmux session: $session"
  else
    echo "  — Session not running: $session"
  fi
}

stop_session "memory-benchmarks"
stop_session "mem0-db2"
stop_session "mem0-qdrant"

# Belt-and-suspenders: free the ports
for PORT in 8888 8889 3000; do
  PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [[ -n "$PIDS" ]]; then
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    echo "  ✓ Freed port $PORT"
  fi
done

echo ""
echo "  All services stopped."
