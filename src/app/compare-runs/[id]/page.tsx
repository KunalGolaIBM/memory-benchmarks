"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";

/* ─────────────────────────────── types ───────────────────────────────── */
interface SubRun {
  slot: "A" | "B" | "C";
  run_id?: string;
  project_name?: string;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  result_file?: string | null;
  progress?: {
    percent: number;
    current: number;
    total: number;
    eta: string;
    label: string;
  } | null;
}

interface CompDetail {
  id: string;
  label: string;
  benchmark: string;
  mode: string;
  conversations: string;
  max_questions?: number;
  status: string;
  db2_host?: string;
  db2_port?: number;
  db2_database?: string;
  db2_username?: string;
  llm_config: Record<string, unknown>;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  sub_runs: { A: SubRun; B: SubRun; C: SubRun };
}

interface ResultAccuracy {
  accuracy?: number;
  total?: number;
  passed?: number;
}

interface RunResults {
  overall?: ResultAccuracy;
  by_group?: Record<string, ResultAccuracy>;
}

/* ─────────────────────────────── helpers ─────────────────────────────── */
function statusColor(s: string) {
  switch (s) {
    case "succeeded":  case "completed": return "text-emerald-600 bg-emerald-50 border-emerald-200";
    case "running":    return "text-blue-600 bg-blue-50 border-blue-200";
    case "failed":     return "text-red-600 bg-red-50 border-red-200";
    case "stopped":    return "text-neutral-500 bg-neutral-50 border-neutral-200";
    case "pending":    return "text-amber-600 bg-amber-50 border-amber-200";
    default:           return "text-neutral-400 bg-neutral-50 border-neutral-100";
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusColor(status)}`}>
      {status.toUpperCase()}
    </span>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full bg-neutral-100 rounded-full h-1.5 mt-1">
      <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}

function pct(v?: number | null) {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function elapsed(start?: string | null, end?: string | null): string {
  if (!start) return "—";
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ═══════════════════════════════ PAGE ════════════════════════════════════ */
export default function CompareRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [cmp, setCmp] = useState<CompDetail | null>(null);
  const [results, setResults] = useState<Record<"A" | "B" | "C", RunResults | null>>({ A: null, B: null, C: null });
  const [loading, setLoading] = useState(true);

  const fetchCmp = useCallback(async () => {
    try {
      const res = await fetch(`/api/comparison-runs/${id}`);
      if (!res.ok) return;
      const data: CompDetail = await res.json();
      setCmp(data);

      // Fetch results for completed sub-runs
      for (const slot of ["A", "B", "C"] as const) {
        const sr = data.sub_runs[slot];
        if ((sr.status === "succeeded" || sr.status === "completed") && sr.run_id && !results[slot]) {
          fetch(`/api/runs/${sr.run_id}/results`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => {
              if (d?.metrics) {
                setResults((prev) => ({ ...prev, [slot]: d.metrics }));
              }
            })
            .catch(() => null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [id, results]);

  useEffect(() => {
    fetchCmp();
    const t = setInterval(fetchCmp, 6000);
    return () => clearInterval(t);
  }, [fetchCmp]);

  if (loading) {
    return <div className="text-sm text-neutral-400 text-center py-16"><Loader2 size={20} className="animate-spin mx-auto" /></div>;
  }
  if (!cmp) {
    return <div className="text-sm text-red-500 py-8">Comparison run not found.</div>;
  }

  const slots: { slot: "A" | "B" | "C"; label: string; color: string }[] = [
    { slot: "A", label: "mem0 + Db2",     color: "text-blue-600 bg-blue-50 border-blue-200" },
    { slot: "B", label: "mem0 + Qdrant",  color: "text-purple-600 bg-purple-50 border-purple-200" },
    { slot: "C", label: "No memory",      color: "text-neutral-600 bg-neutral-50 border-neutral-200" },
  ];

  // Comparison numbers
  const accA = results.A?.overall?.accuracy;
  const accB = results.B?.overall?.accuracy;
  const accC = results.C?.overall?.accuracy;

  const delta = (a?: number | null, b?: number | null) => {
    if (a == null || b == null) return null;
    return a - b;
  };
  const memoryGain  = delta(accA, accC); // A vs C: does memory help?
  const db2VsQdrant = delta(accA, accB); // A vs B: is Db2 better than Qdrant?

  return (
    <div className="max-w-5xl animate-in space-y-8">
      {/* Header */}
      <div>
        <Link href="/compare-runs" className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-600 mb-4">
          <ArrowLeft size={14} /> Back to comparisons
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{cmp.label}</h1>
            <p className="text-sm text-neutral-400 mt-0.5">
              {cmp.benchmark.toUpperCase()} · {cmp.mode} · convs {cmp.conversations}
              {cmp.max_questions ? ` · max ${cmp.max_questions} questions` : ""}
            </p>
          </div>
          <StatusBadge status={cmp.status} />
        </div>
      </div>

      {/* Summary comparison table — only show when ≥2 results are in */}
      {(accA != null || accB != null || accC != null) && (
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="text-sm font-semibold text-neutral-900">Results Comparison</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 border-b">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-medium text-neutral-500">Run</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-neutral-500">Setup</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-neutral-500">Accuracy @50</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-neutral-500">Questions</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-neutral-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {slots.map(({ slot, label }) => {
                const sr = cmp.sub_runs[slot];
                const res = results[slot];
                return (
                  <tr key={slot} className="border-b last:border-0">
                    <td className="px-6 py-3 font-semibold text-neutral-700">{slot}</td>
                    <td className="px-6 py-3 text-neutral-600">{label} + {String(cmp.llm_config.answerer_model ?? "llama3.2")}</td>
                    <td className="px-6 py-3 text-right font-mono font-semibold">
                      {pct(res?.overall?.accuracy)}
                    </td>
                    <td className="px-6 py-3 text-right text-neutral-500">
                      {res?.overall?.total ?? "—"}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <StatusBadge status={sr.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Key findings */}
          {(memoryGain != null || db2VsQdrant != null) && (
            <div className="px-6 py-4 border-t bg-neutral-50 grid grid-cols-2 gap-6">
              {memoryGain != null && (
                <div>
                  <div className="text-[11px] text-neutral-400 font-medium uppercase tracking-wider mb-1">
                    Memory gain (A vs C)
                  </div>
                  <div className={`text-2xl font-semibold tabular-nums ${memoryGain >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {memoryGain >= 0 ? "+" : ""}{memoryGain.toFixed(1)} pp
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {Math.abs(memoryGain) < 1
                      ? "No significant difference at this sample size"
                      : memoryGain > 0
                        ? "Memory improves accuracy"
                        : "Memory does not help at this scale"}
                  </div>
                </div>
              )}
              {db2VsQdrant != null && (
                <div>
                  <div className="text-[11px] text-neutral-400 font-medium uppercase tracking-wider mb-1">
                    Db2 vs Qdrant (A vs B)
                  </div>
                  <div className={`text-2xl font-semibold tabular-nums ${db2VsQdrant >= 0 ? "text-blue-600" : "text-purple-600"}`}>
                    {db2VsQdrant >= 0 ? "+" : ""}{db2VsQdrant.toFixed(1)} pp
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {Math.abs(db2VsQdrant) < 1
                      ? "Db2 and Qdrant perform equivalently"
                      : db2VsQdrant > 0
                        ? "Db2 outperforms Qdrant"
                        : "Qdrant outperforms Db2"}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sub-run cards */}
      <div className="grid gap-5">
        {slots.map(({ slot, label, color }) => {
          const sr = cmp.sub_runs[slot];
          const res = results[slot];
          return (
            <div key={slot} className="rounded-xl border bg-white overflow-hidden">
              <div className={`border-b px-6 py-4 flex items-center justify-between gap-4 ${color.includes("blue") ? "bg-blue-50/30" : color.includes("purple") ? "bg-purple-50/20" : "bg-neutral-50/50"}`}>
                <div>
                  <span className="font-semibold text-neutral-900 mr-2">Run {slot}</span>
                  <span className="text-sm text-neutral-500">{label} + {String(cmp.llm_config.answerer_model ?? "llama3.2")}</span>
                </div>
                <div className="flex items-center gap-3">
                  {sr.started_at && (
                    <span className="text-xs text-neutral-400 flex items-center gap-1">
                      <Clock size={11} /> {elapsed(sr.started_at, sr.finished_at)}
                    </span>
                  )}
                  <StatusBadge status={sr.status} />
                  {sr.run_id && (
                    <Link href={`/runs/${sr.run_id}`}
                      className="text-xs text-neutral-400 hover:text-neutral-700 underline">
                      View run →
                    </Link>
                  )}
                </div>
              </div>

              <div className="px-6 py-4 space-y-3">
                {/* Progress */}
                {sr.status === "running" && sr.progress && (
                  <div>
                    <div className="flex justify-between text-xs text-neutral-500 mb-1">
                      <span>{sr.progress.label}</span>
                      <span>{sr.progress.current}/{sr.progress.total} · ETA {sr.progress.eta || "—"}</span>
                    </div>
                    <ProgressBar percent={sr.progress.percent} />
                  </div>
                )}

                {/* Waiting state */}
                {(sr.status === "pending" || sr.status === "not_started") && (
                  <div className="text-sm text-neutral-400 flex items-center gap-2">
                    <Clock size={13} /> Waiting to start…
                  </div>
                )}

                {/* Results when done */}
                {res?.overall && (
                  <div>
                    <div className="flex items-center gap-4 mb-3">
                      <div>
                        <div className="text-2xl font-semibold tabular-nums text-neutral-900">
                          {pct(res.overall.accuracy)}
                        </div>
                        <div className="text-xs text-neutral-400">overall accuracy</div>
                      </div>
                      <div>
                        <div className="text-lg font-medium tabular-nums text-neutral-700">
                          {res.overall.passed ?? "—"} / {res.overall.total ?? "—"}
                        </div>
                        <div className="text-xs text-neutral-400">correct / total</div>
                      </div>
                    </div>

                    {res.by_group && (
                      <div className="grid grid-cols-4 gap-2">
                        {Object.entries(res.by_group).map(([group, m]) => (
                          <div key={group} className="rounded-lg bg-neutral-50 px-3 py-2 text-center">
                            <div className="text-xs font-medium text-neutral-400 truncate">{group}</div>
                            <div className="text-sm font-semibold text-neutral-800 mt-0.5">{pct(m.accuracy)}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {slot === "C" && (
                      <p className="text-[11px] text-neutral-400 mt-2 bg-neutral-50 rounded px-2 py-1">
                        No memory retrieved — LLM answered from zero context. This is the baseline.
                      </p>
                    )}
                  </div>
                )}

                {/* Failed */}
                {sr.status === "failed" && (
                  <div className="text-sm text-red-500 flex items-center gap-2">
                    <XCircle size={13} /> Run failed.
                    {sr.run_id && (
                      <Link href={`/runs/${sr.run_id}`} className="underline">See logs →</Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Config summary */}
      <details className="rounded-xl border bg-white">
        <summary className="px-6 py-4 text-sm text-neutral-500 cursor-pointer select-none hover:text-neutral-700 font-medium">
          Configuration details
        </summary>
        <div className="px-6 pb-5 pt-2 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          {[
            ["Benchmark", cmp.benchmark.toUpperCase()],
            ["Mode", cmp.mode],
            ["Conversations", cmp.conversations],
            ["Db2 host", cmp.db2_host ?? "—"],
            ["Db2 database", cmp.db2_database ?? "—"],
            ["Db2 user", cmp.db2_username ?? "—"],
            ["Answerer", String(cmp.llm_config.answerer_model ?? "—")],
            ["Judge", String(cmp.llm_config.judge_model ?? "—")],
            ["Ollama URL", String(cmp.llm_config.base_url ?? "—")],
            ["Top K", String(cmp.llm_config.top_k ?? "—")],
            ["Top K cutoffs", String(cmp.llm_config.top_k_cutoffs ?? "—")],
            ["Started", cmp.started_at ? new Date(cmp.started_at).toLocaleString() : "—"],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-neutral-400 min-w-28">{k}</span>
              <span className="font-mono text-neutral-700 truncate">{v}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
