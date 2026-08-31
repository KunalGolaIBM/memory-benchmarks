/**
 * GET  /api/comparison-runs  — list all comparison runs
 * POST /api/comparison-runs  — create and launch a new comparison (A+B+C)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listComparisonRuns,
  launchComparison,
  type LaunchParams,
} from "@/lib/comparison-runs";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(listComparisonRuns());
}

export async function POST(req: NextRequest) {
  let body: LaunchParams;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Basic validation
  if (!body.label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  if (!body.db2?.password) {
    return NextResponse.json({ error: "db2.password is required" }, { status: 400 });
  }
  if (!body.llm?.answerer_model) {
    return NextResponse.json({ error: "llm.answerer_model is required" }, { status: 400 });
  }

  try {
    const cmp = await launchComparison(body);
    return NextResponse.json(cmp, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
