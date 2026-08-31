"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import { ArrowLeft, CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react";

/* ─────────────────────────────── styles ──────────────────────────────── */
const INPUT  = "w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-400";
const SELECT = "w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-400";
const LABEL  = "block text-xs text-neutral-500 mb-1";
const SEC    = "text-[11px] font-medium text-neutral-400 uppercase tracking-wider";

/* ─────────────────────────── check result types ──────────────────────── */
type CheckStatus = "ok" | "fail" | "warn" | "skip";
interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  suggestion?: string;
}
interface ValidationResponse {
  ok: boolean;
  checks: CheckResult[];
  summary: { total: number; passed: number; failed: number; warnings: number };
}

/* ─────────────────────────────── helpers ─────────────────────────────── */
function CheckIcon({ status }: { status: CheckStatus | "running" }) {
  if (status === "running") return <Loader2 size={14} className="animate-spin text-blue-500" />;
  if (status === "ok")   return <CheckCircle2 size={14} className="text-emerald-500" />;
  if (status === "fail") return <XCircle size={14} className="text-red-500" />;
  return <AlertCircle size={14} className="text-amber-500" />;
}

/* ═══════════════════════════════ FORM ════════════════════════════════════ */
export default function NewCompareRunPage() {
  const router = useRouter();

  /* ── Identification ─────────────────────────────────────────────────── */
  const [label, setLabel] = useState("");

  /* ── Benchmark scope ────────────────────────────────────────────────── */
  const [mode, setMode] = useState<"smoke" | "single" | "full">("smoke");
  const [singleConv, setSingleConv] = useState(0);

  /* ── Db2 config ─────────────────────────────────────────────────────── */
  const [db2Host, setDb2Host]         = useState("9.21.131.70");
  const [db2Port, setDb2Port]         = useState(50000);
  const [db2Database, setDb2Database] = useState("SAMPLE");
  const [db2Username, setDb2Username] = useState("gola");
  const [db2Password, setDb2Password] = useState("");
  const [db2ConnName, setDb2ConnName] = useState("new_db2_amd64_for_memo");

  /* ── Qdrant config ──────────────────────────────────────────────────── */
  const [qdrantHost, setQdrantHost] = useState("localhost");
  const [qdrantPort, setQdrantPort] = useState(6333);

  /* ── LLM config ─────────────────────────────────────────────────────── */
  const [ollamaUrl, setOllamaUrl]       = useState("http://localhost:11434/v1");
  const [answererModel, setAnswererModel] = useState("llama3.2");
  const [judgeModel, setJudgeModel]       = useState("llama3.2");
  const [topK, setTopK]                   = useState(200);
  const [topKCutoffs, setTopKCutoffs]     = useState("10,20,50,200");
  const [maxWorkers, setMaxWorkers]       = useState(2);

  /* ── mem0 ports ─────────────────────────────────────────────────────── */
  const [mem0Db2Port,    setMem0Db2Port]    = useState(8888);
  const [mem0QdrantPort, setMem0QdrantPort] = useState(8889);

  /* ── Validation state ───────────────────────────────────────────────── */
  const [validating, setValidating]           = useState(false);
  const [validation, setValidation]           = useState<ValidationResponse | null>(null);

  /* ── Submit state ───────────────────────────────────────────────────── */
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState("");

  /* ── Compute conversations string from mode ─────────────────────────── */
  const conversations = (() => {
    if (mode === "smoke" || mode === "single") return String(singleConv);
    return "0,1,2,3,4,5,6,7,8,9";
  })();
  const maxQuestions = mode === "smoke" ? 10 : undefined;

  /* ── Validate ─────────────────────────────────────────────────────────  */
  const handleValidate = useCallback(async () => {
    if (!db2Password) { setError("Please enter the Db2 password before validating"); return; }
    setError("");
    setValidating(true);
    setValidation(null);
    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          db2: { host: db2Host, port: db2Port, database: db2Database, username: db2Username, password: db2Password },
          llm: { base_url: ollamaUrl, answerer_model: answererModel },
          qdrant: { host: qdrantHost, port: qdrantPort },
          mem0_db2_port: mem0Db2Port,
          mem0_qdrant_port: mem0QdrantPort,
        }),
      });
      const data: ValidationResponse = await res.json();
      setValidation(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation request failed");
    } finally {
      setValidating(false);
    }
  }, [db2Host, db2Port, db2Database, db2Username, db2Password, ollamaUrl, answererModel, qdrantHost, qdrantPort, mem0Db2Port, mem0QdrantPort]);

  /* ── Submit ────────────────────────────────────────────────────────── */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label)       { setError("Label is required"); return; }
    if (!db2Password) { setError("Db2 password is required"); return; }
    if (validation && !validation.ok) {
      setError("Validation failed — fix the issues above before running");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/comparison-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          benchmark: "locomo",
          mode,
          conversations,
          max_questions: maxQuestions,
          llm: {
            provider: "openai",
            base_url: ollamaUrl,
            api_key: "ollama",
            answerer_model: answererModel,
            judge_model: judgeModel,
            judge_base_url: ollamaUrl,
            judge_api_key: "ollama",
            top_k: topK,
            top_k_cutoffs: topKCutoffs,
          },
          db2: {
            host: db2Host,
            port: db2Port,
            database: db2Database,
            username: db2Username,
            password: db2Password,        // sent once over HTTPS, never stored
            connection_name: db2ConnName,
          },
          qdrant: { host: qdrantHost, port: qdrantPort },
          mem0_db2_port: mem0Db2Port,
          mem0_qdrant_port: mem0QdrantPort,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const cmp = await res.json();
      router.push(`/compare-runs/${cmp.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  }

  /* ── Benchmark mode helper text ─────────────────────────────────────── */
  const modeDesc = {
    smoke:  `Conv ${singleConv}, 10 questions · ~30 min total (all 3 runs)`,
    single: `Conv ${singleConv}, all questions · ~3 h total`,
    full:   `All 10 conversations · ~35 h total`,
  };

  return (
    <div className="max-w-2xl animate-in">
      <Link href="/compare-runs" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-600 mb-6">
        <ArrowLeft size={14} /> Back
      </Link>

      <div className="mb-8">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">New A/B/C Comparison</h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          Runs three benchmarks simultaneously: mem0+Db2, mem0+Qdrant, and no-memory baseline
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-7">

        {/* ── Label ────────────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <h3 className={SEC}>Run Label</h3>
          <div>
            <label className={LABEL}>Label <span className="text-red-400">*</span></label>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              className={INPUT} placeholder="e.g. db2-vs-qdrant-smoke-2026-09" required />
          </div>
        </div>

        {/* ── Benchmark scope ──────────────────────────────────────────── */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <h3 className={SEC}>Benchmark Mode</h3>

          <div className="grid grid-cols-3 gap-3">
            {(["smoke", "single", "full"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`text-left rounded-xl border p-4 cursor-pointer transition-all ${
                  mode === m ? "border-indigo-500 bg-indigo-50/30 ring-1 ring-indigo-500/20" : "bg-white hover:border-neutral-300"
                }`}>
                <div className="text-sm font-semibold text-neutral-900 capitalize">
                  {m === "smoke" ? "Smoke Test" : m === "single" ? "Single Conv" : "Full LOCOMO"}
                </div>
                <div className="text-[11px] text-neutral-400 mt-1">
                  {m === "smoke" ? "10 questions · fast" : m === "single" ? "~150 questions" : "All 10 convs"}
                </div>
              </button>
            ))}
          </div>

          {(mode === "smoke" || mode === "single") && (
            <div>
              <label className={LABEL}>Conversation (0–9)</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {[0,1,2,3,4,5,6,7,8,9].map((idx) => (
                  <button key={idx} type="button" onClick={() => setSingleConv(idx)}
                    className={`w-10 h-10 rounded-lg text-sm font-medium border transition-all ${
                      singleConv === idx
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
                    }`}>{idx}</button>
                ))}
              </div>
            </div>
          )}

          <p className="text-[12px] text-neutral-400 bg-neutral-50 rounded-lg px-3 py-2 font-mono">
            {modeDesc[mode]}
          </p>

          {mode === "full" && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠ Full run takes ~35 h per scenario × 3 = ~105 h. Processes continue on the VM
              even after you close the browser. You can monitor progress any time by reopening this page.
            </p>
          )}
        </div>

        {/* ── Db2 config ───────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <h3 className={SEC}>IBM Db2 Configuration — Run A</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={LABEL}>Host</label>
              <input value={db2Host} onChange={(e) => setDb2Host(e.target.value)} className={`${INPUT} font-mono`} /></div>
            <div><label className={LABEL}>Port</label>
              <input type="number" value={db2Port} onChange={(e) => setDb2Port(+e.target.value)} className={INPUT} /></div>
            <div><label className={LABEL}>Database</label>
              <input value={db2Database} onChange={(e) => setDb2Database(e.target.value)} className={`${INPUT} font-mono`} /></div>
            <div><label className={LABEL}>Username</label>
              <input value={db2Username} onChange={(e) => setDb2Username(e.target.value)} className={INPUT} /></div>
            <div className="col-span-2">
              <label className={LABEL}>Password <span className="text-red-400">*</span>
                <span className="ml-2 text-neutral-300 font-normal normal-case tracking-normal">(never stored — used only at runtime)</span>
              </label>
              <input type="password" value={db2Password} onChange={(e) => setDb2Password(e.target.value)}
                className={INPUT} placeholder="Enter Db2 password" autoComplete="off" required />
            </div>
            <div className="col-span-2"><label className={LABEL}>Connection name (optional)</label>
              <input value={db2ConnName} onChange={(e) => setDb2ConnName(e.target.value)} className={INPUT} /></div>
          </div>
          <p className="text-[11px] text-neutral-400 leading-relaxed">
            The password is passed directly to the benchmark process as an environment variable.
            It is never written to the database, logs, or any result files.
          </p>
        </div>

        {/* ── Qdrant config ─────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <h3 className={SEC}>Qdrant Configuration — Run B</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={LABEL}>Host</label>
              <input value={qdrantHost} onChange={(e) => setQdrantHost(e.target.value)} className={`${INPUT} font-mono`} /></div>
            <div><label className={LABEL}>Port</label>
              <input type="number" value={qdrantPort} onChange={(e) => setQdrantPort(+e.target.value)} className={INPUT} /></div>
          </div>
          <p className="text-[11px] text-neutral-400">
            Qdrant must be running on the VM before starting. If not installed:
            <code className="ml-1 bg-neutral-100 px-1 rounded text-neutral-600">docker run -d --name qdrant -p 6333:6333 qdrant/qdrant</code>
          </p>
        </div>

        {/* ── LLM config ────────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <h3 className={SEC}>LLM Configuration (same for all 3 runs)</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><label className={LABEL}>Ollama base URL</label>
              <input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)}
                className={`${INPUT} font-mono`} placeholder="http://localhost:11434/v1" /></div>
            <div><label className={LABEL}>Answerer model</label>
              <input value={answererModel} onChange={(e) => setAnswererModel(e.target.value)} className={INPUT} /></div>
            <div><label className={LABEL}>Judge model</label>
              <input value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)} className={INPUT} /></div>
            <div><label className={LABEL}>Top K (memories fetched)</label>
              <input type="number" value={topK} onChange={(e) => setTopK(+e.target.value)} className={INPUT} /></div>
            <div><label className={LABEL}>Top K cutoffs</label>
              <input value={topKCutoffs} onChange={(e) => setTopKCutoffs(e.target.value)} className={`${INPUT} font-mono`} /></div>
            <div><label className={LABEL}>Max workers (parallel questions)</label>
              <input type="number" value={maxWorkers} min={1} max={8} onChange={(e) => setMaxWorkers(+e.target.value)} className={INPUT} /></div>
          </div>
          <p className="text-[11px] text-neutral-400">
            All three runs (A, B, C) use the identical LLM configuration. The only intentional
            difference is the memory backend (Db2 / Qdrant / none).
          </p>
        </div>

        {/* ── Advanced: mem0 ports ──────────────────────────────────────── */}
        <details className="rounded-xl border bg-white">
          <summary className="px-6 py-4 text-xs text-neutral-500 cursor-pointer select-none font-medium hover:text-neutral-700">
            Advanced — mem0 server ports
          </summary>
          <div className="px-6 pb-5 pt-2 grid grid-cols-2 gap-4">
            <div><label className={LABEL}>mem0 Db2 server port</label>
              <input type="number" value={mem0Db2Port} onChange={(e) => setMem0Db2Port(+e.target.value)} className={INPUT} /></div>
            <div><label className={LABEL}>mem0 Qdrant server port</label>
              <input type="number" value={mem0QdrantPort} onChange={(e) => setMem0QdrantPort(+e.target.value)} className={INPUT} /></div>
          </div>
          <p className="px-6 pb-4 text-[11px] text-neutral-400">
            Runs A and B each need their own mem0 server instance. Change these ports only if
            the defaults (8888/8889) conflict with something else on the VM.
          </p>
        </details>

        {/* ── Validation panel ─────────────────────────────────────────── */}
        <div className="rounded-xl border bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className={SEC}>Pre-flight Validation</h3>
            <button type="button" onClick={handleValidate} disabled={validating}
              className="px-4 py-2 text-sm font-medium border rounded-lg bg-neutral-50 hover:bg-neutral-100 disabled:opacity-50 transition-colors">
              {validating ? <span className="flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Validating…</span> : "Validate Configuration"}
            </button>
          </div>

          {validation && (
            <div className="space-y-2">
              <div className={`text-sm font-medium ${validation.ok ? "text-emerald-600" : "text-red-600"}`}>
                {validation.ok
                  ? `✓ All ${validation.summary.passed} checks passed — ready to run`
                  : `✗ ${validation.summary.failed} check(s) failed — fix before running`}
                {validation.summary.warnings > 0 && (
                  <span className="ml-2 text-amber-600 font-normal text-xs">
                    ({validation.summary.warnings} warning{validation.summary.warnings > 1 ? "s" : ""})
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {validation.checks.map((c) => (
                  <div key={c.id}
                    className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm ${
                      c.status === "ok"   ? "bg-emerald-50/60" :
                      c.status === "fail" ? "bg-red-50" :
                      c.status === "warn" ? "bg-amber-50/60" : "bg-neutral-50"
                    }`}>
                    <CheckIcon status={c.status} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-neutral-800">{c.label}</div>
                      {c.detail && <div className="text-xs text-neutral-500 mt-0.5 font-mono">{c.detail}</div>}
                      {c.suggestion && c.status === "fail" && (
                        <div className="text-xs text-red-600 mt-1 font-medium">
                          → {c.suggestion}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!validation && !validating && (
            <p className="text-xs text-neutral-400">
              Click <strong>Validate Configuration</strong> to check Db2, Qdrant, Ollama, and file system
              before starting. Strongly recommended before a full run.
            </p>
          )}
        </div>

        {/* ── Error ─────────────────────────────────────────────────────── */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {/* ── Submit ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2">
          <Link href="/compare-runs" className="text-sm text-neutral-400 hover:text-neutral-600">Cancel</Link>
          <div className="flex gap-3">
            <button type="button" onClick={handleValidate} disabled={validating}
              className="px-4 py-2.5 text-sm font-medium border rounded-lg bg-white hover:bg-neutral-50 disabled:opacity-50">
              {validating ? "Validating…" : "Validate"}
            </button>
            <button type="submit" disabled={submitting || !label || !db2Password}
              className="px-5 py-2.5 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
              {submitting ? "Starting…" : "Run Comparison (A + B + C)"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
