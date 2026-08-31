/**
 * GET  /api/comparison-runs/[id]  — status + sub-run progress
 * DELETE /api/comparison-runs/[id] — remove the comparison record
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getComparisonRun,
  deleteComparisonRun,
  syncComparisonStatus,
} from "@/lib/comparison-runs";
import { getRun } from "@/lib/runs";
import { getProgress } from "@/lib/executor";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  syncComparisonStatus(id); // keep status column fresh
  const cmp = getComparisonRun(id);
  if (!cmp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Enrich with sub-run progress
  const enrich = (runId: string | null, slot: "A" | "B" | "C") => {
    if (!runId) return { slot, status: "not_started" };
    const run = getRun(runId);
    if (!run) return { slot, status: "not_found", run_id: runId };
    const isActive = run.status === "running" || run.status === "pending";
    const progress = isActive && run.log_file ? getProgress(run.log_file, run.started_at) : null;
    return {
      slot,
      run_id: run.id,
      project_name: run.project_name,
      status: run.status,
      started_at: run.started_at,
      finished_at: run.finished_at,
      result_file: run.result_file,
      progress,
    };
  };

  return NextResponse.json({
    ...cmp,
    llm_config: JSON.parse(cmp.llm_config ?? "{}"),
    sub_runs: {
      A: enrich(cmp.run_a_id, "A"),
      B: enrich(cmp.run_b_id, "B"),
      C: enrich(cmp.run_c_id, "C"),
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const cmp = getComparisonRun(id);
  if (!cmp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  deleteComparisonRun(id);
  return NextResponse.json({ ok: true });
}
