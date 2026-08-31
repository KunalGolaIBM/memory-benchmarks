"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Plus, FlaskConical } from "lucide-react";

interface SubRunSummary {
  slot: string;
  status: string;
  progress?: { percent: number; current: number; total: number; eta: string } | null;
}

interface CmpRun {
  id: string;
  label: string;
  benchmark: string;
  mode: string;
  conversations: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  sub_runs?: { A: SubRunSummary; B: SubRunSummary; C: SubRunSummary };
}

function statusColor(s: string) {
  switch (s) {
    case "completed": return "text-emerald-600 bg-emerald-50 border-emerald-200";
    case "running":   return "text-blue-600 bg-blue-50 border-blue-200";
    case "failed":    return "text-red-600 bg-red-50 border-red-200";
    case "stopped":   return "text-neutral-500 bg-neutral-50 border-neutral-200";
    default:          return "text-neutral-400 bg-neutral-50 border-neutral-200";
  }
}

function timeAgo(s: string | null) {
  if (!s) return "—";
  const diff = Date.now() - new Date(s).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function CompareRunsPage() {
  const [runs, setRuns] = useState<CmpRun[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/comparison-runs");
      if (res.ok) setRuns(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    const t = setInterval(fetchRuns, 8000);
    return () => clearInterval(t);
  }, [fetchRuns]);

  return (
    <div className="max-w-5xl animate-in">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
            A/B/C Comparison Runs
          </h1>
          <p className="text-sm text-neutral-400 mt-0.5">
            Each comparison runs three benchmarks: mem0+Db2, mem0+Qdrant, and no-memory baseline
          </p>
        </div>
        <Link
          href="/compare-runs/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={14} />
          New Comparison
        </Link>
      </div>

      {loading && (
        <div className="text-sm text-neutral-400 text-center py-16">Loading…</div>
      )}

      {!loading && runs.length === 0 && (
        <div className="border border-dashed rounded-xl p-16 text-center">
          <FlaskConical size={28} className="mx-auto mb-3 text-neutral-300" />
          <p className="text-neutral-500 font-medium">No comparison runs yet</p>
          <p className="text-sm text-neutral-400 mt-1">
            Click <strong>New Comparison</strong> to run A/B/C benchmarks
          </p>
        </div>
      )}

      <div className="space-y-3">
        {runs.map((run) => (
          <Link
            key={run.id}
            href={`/compare-runs/${run.id}`}
            className="block border rounded-xl bg-white hover:border-neutral-300 transition-all p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-neutral-900 truncate">{run.label}</span>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusColor(run.status)}`}>
                    {run.status.toUpperCase()}
                  </span>
                </div>
                <div className="text-xs text-neutral-400 font-mono">
                  {run.benchmark.toUpperCase()} · {run.mode} · convs {run.conversations}
                </div>
              </div>
              <div className="text-xs text-neutral-400 whitespace-nowrap">
                {timeAgo(run.started_at ?? run.created_at)}
              </div>
            </div>

            {/* Sub-run indicators */}
            <div className="flex gap-3 mt-3">
              {(["A", "B", "C"] as const).map((slot) => {
                const label = slot === "A" ? "Db2" : slot === "B" ? "Qdrant" : "No memory";
                const sr = run.sub_runs?.[slot];
                const s = sr?.status ?? "not_started";
                return (
                  <div key={slot} className={`flex-1 rounded-lg border px-3 py-2 text-center ${statusColor(s)}`}>
                    <div className="text-[11px] font-semibold">Run {slot}</div>
                    <div className="text-[10px] opacity-70">{label}</div>
                    {sr?.progress && s === "running" && (
                      <div className="text-[10px] mt-0.5">{sr.progress.percent}%</div>
                    )}
                  </div>
                );
              })}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
