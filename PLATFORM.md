# Memory Benchmarks Platform — Operations Runbook

> **Deployment target**: Linux AMD64 Fyre VM  
> **VM IPs**: `10.14.77.251` / `9.21.131.70`  
> **Home**: `/home/gola/memory-benchmarks`

---

## Architecture

```
Browser (your laptop)
        │
        │  HTTP (SSH tunnel or direct)
        ▼
┌──────────────────────────────────────────────────┐
│  Fyre VM  (Linux AMD64)                          │
│                                                  │
│  tmux: memory-benchmarks  → Next.js :3000        │
│                                │                 │
│                    ┌───────────┴──────────┐      │
│                    │                      │      │
│  tmux: mem0-db2    │   tmux: mem0-qdrant  │      │
│    → uvicorn :8888 │     → uvicorn :8889  │      │
│    → IBM Db2       │     → Qdrant :6333   │      │
│                    └──────────────────────┘      │
│                                                  │
│  Background: Ollama :11434  (llama3.2)           │
│  Background: Qdrant :6333   (docker)             │
└──────────────────────────────────────────────────┘
```

### The three comparison scenarios

| Run | Setup | What it proves |
|-----|-------|----------------|
| **A** | mem0 + IBM Db2 + llama3.2 | Primary IBM scenario |
| **B** | mem0 + Qdrant + llama3.2 | Db2 vs Qdrant comparison |
| **C** | No memory + llama3.2 | Does memory help at all? |

All three use the **identical LLM, questions, judge, and cutoffs** — the only intentional difference is the memory backend.

---

## First-time setup on the VM

```bash
# SSH into the VM
ssh gola@9.21.131.70

# Clone repo (if not already there)
cd /home/gola
git clone <repo-url> memory-benchmarks
cd memory-benchmarks

# Install Python dependencies
pip3 install -r requirements.txt

# Install Node dependencies
npm ci

# Build the Next.js app
npm run build

# Pull Ollama models
OLLAMA_HOST=0.0.0.0 ollama serve &
ollama pull llama3.2
ollama pull nomic-embed-text

# Start Qdrant (for Run B)
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
```

---

## Starting the platform

```bash
cd /home/gola/memory-benchmarks

# Provide Db2 password (prompted if not set)
MEM0_DB2_PASSWORD="your-db2-password" ./scripts/platform/start-platform.sh
```

This starts three persistent tmux sessions that **survive SSH disconnection**:

| tmux session | Service | Port |
|---|---|---|
| `memory-benchmarks` | Next.js frontend | 3000 |
| `mem0-db2` | mem0 server (Db2) | 8888 |
| `mem0-qdrant` | mem0 server (Qdrant) | 8889 |

---

## Accessing the frontend

### Option 1 — SSH tunnel (recommended, most secure)
```bash
# From your local machine:
ssh -L 3000:localhost:3000 gola@9.21.131.70
# Then open in browser:
open http://localhost:3000
```

### Option 2 — Direct access (if port 3000 is open on the VM firewall)
```
http://9.21.131.70:3000
```

---

## Running a comparison benchmark

1. Open `http://localhost:3000` (via SSH tunnel)
2. Click **Compare A/B/C** in the top navigation
3. Click **New Comparison**
4. Fill in:
   - **Label** — a name for this comparison run
   - **Benchmark mode** — Smoke Test (10 questions, ~30 min) or Full LOCOMO (~35 h)
   - **Db2 credentials** — host, port, database, username, password
   - **Qdrant** — host/port (defaults: localhost:6333)
   - **LLM config** — Ollama URL, models
5. Click **Validate Configuration** — all checks must pass
6. Click **Run Comparison (A + B + C)**
7. Monitor progress on the detail page — refreshes every 6 seconds

**The benchmark continues running on the VM even if you close the browser.**

---

## Stopping the platform

```bash
cd /home/gola/memory-benchmarks
./scripts/platform/stop-platform.sh
```

This kills all three tmux sessions and frees ports 3000, 8888, 8889.

---

## Checking status

```bash
cd /home/gola/memory-benchmarks
./scripts/platform/status-platform.sh
```

Shows:
- tmux session states
- HTTP health of each service
- Ollama status and available models
- Qdrant status
- Recent benchmark runs from evals.db

---

## Restarting a single service

```bash
# Restart everything
./scripts/platform/restart-platform.sh

# Restart only the frontend
./scripts/platform/restart-platform.sh frontend

# Restart only the Db2 mem0 server
MEM0_DB2_PASSWORD="password" ./scripts/platform/restart-platform.sh mem0-db2

# Restart only the Qdrant mem0 server
./scripts/platform/restart-platform.sh mem0-qdrant
```

---

## Attaching to tmux sessions (for debugging)

```bash
# List all sessions
tmux ls

# Attach to the frontend
tmux attach -t memory-benchmarks

# Attach to the Db2 mem0 server
tmux attach -t mem0-db2

# Attach to the Qdrant mem0 server
tmux attach -t mem0-qdrant

# Detach without killing: Ctrl-B then D
```

---

## Viewing logs

```bash
# Platform logs
tail -f /home/gola/memory-benchmarks/logs/platform/frontend.log
tail -f /home/gola/memory-benchmarks/logs/platform/mem0-db2.log
tail -f /home/gola/memory-benchmarks/logs/platform/mem0-qdrant.log

# Individual benchmark run logs
ls /home/gola/memory-benchmarks/logs/
tail -f /home/gola/memory-benchmarks/logs/<run-id>.log
```

**Passwords never appear in logs** — the `MEM0_DB2_PASSWORD` env var is passed to the process but the logging infrastructure does not echo environment variables.

---

## Resuming an interrupted run

If a benchmark was interrupted (VM reboot, crash, etc.):

1. Restart the platform: `./scripts/platform/start-platform.sh`
2. Open the frontend
3. The interrupted run will show `failed` or `running` status
4. Click the run → click **Restart** — the benchmark resumes from its last checkpoint (`--resume` flag)

The benchmark runner saves per-question checkpoints, so it will skip already-answered questions.

---

## Running the smoke test end-to-end (verification)

```bash
# 1. Start the platform
MEM0_DB2_PASSWORD="your-password" ./scripts/platform/start-platform.sh

# 2. Check everything is healthy
./scripts/platform/status-platform.sh

# 3. Open the frontend
ssh -L 3000:localhost:3000 gola@9.21.131.70
# → open http://localhost:3000

# 4. Click "Compare A/B/C" → "New Comparison"
# 5. Enter a label, select "Smoke Test" (conv 0, 10 questions)
# 6. Enter Db2 password
# 7. Click "Validate Configuration" — all checks should pass
# 8. Click "Run Comparison (A + B + C)"
# 9. Observe three sub-runs on the detail page (~30 min total)
# 10. Results table appears automatically when runs complete
```

---

## Configuration files

| File | Purpose |
|---|---|
| `mem0-config-linux-db2.yaml` | mem0 config for Db2 (Linux paths, no hardcoded password) |
| `mem0-config-linux-qdrant.yaml` | mem0 config for Qdrant (Linux paths) |
| `mem0-config.yaml` | Mac development config (Db2) |
| `mem0-config-qdrant.yaml` | Mac development config (Qdrant) |

---

## Port reference

| Port | Service | Notes |
|------|---------|-------|
| 3000 | Next.js frontend | Access via SSH tunnel |
| 8888 | mem0 server (Db2) | Internal only |
| 8889 | mem0 server (Qdrant) | Internal only |
| 11434 | Ollama | Internal only |
| 6333 | Qdrant | Internal only |
| 50000 | IBM Db2 | External (9.21.131.70) |

---

## Security notes

- **Db2 password** is never stored in the database, config files, or logs
- Password is entered in the frontend form, sent over HTTPS in the POST body, and passed to the benchmark process as `MEM0_DB2_PASSWORD` env variable
- Result JSON files do not contain any credentials
- The `mem0-config-linux-db2.yaml` uses `${MEM0_DB2_PASSWORD}` as a placeholder — the actual value must be supplied at runtime
- Commit the config files; they contain no secrets
