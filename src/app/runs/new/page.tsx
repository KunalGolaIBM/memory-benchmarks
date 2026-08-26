"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, Suspense } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";

const BENCHMARKS = [
  {
    id: "locomo",
    name: "LOCOMO-10",
    description: "Multi-session dialogue memory benchmark",
    stats: ["10 conversations", "~300 questions", "4 categories"],
  },
  {
    id: "longmemeval",
    name: "LongMemEval",
    description: "Diverse long-term memory evaluation tasks",
    stats: ["500 questions", "6 types", "multi-session reasoning"],
  },
  {
    id: "beam",
    name: "BEAM",
    description: "Everyday AI memory with large-scale chat histories",
    stats: ["100 convs per size", "20 questions each", "10 memory abilities"],
  },
] as const;

// Provider → default model + whether a base_url field is needed
const PROVIDER_DEFAULTS: Record<
  string,
  { model: string; needsBaseUrl: boolean; defaultBaseUrl: string }
> = {
  ollama:    { model: "llama3.2",       needsBaseUrl: true,  defaultBaseUrl: "http://0.0.0.0:11434/v1" },
  openai:    { model: "gpt-4o",         needsBaseUrl: false, defaultBaseUrl: "" },
  anthropic: { model: "claude-3-5-sonnet-20241022", needsBaseUrl: false, defaultBaseUrl: "" },
  azure:     { model: "gpt-4o",         needsBaseUrl: true,  defaultBaseUrl: "" },
};

const INPUT_CLASS =
  "w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-400";
const SELECT_CLASS =
  "w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/5 focus:border-neutral-400";
const LABEL_CLASS = "block text-xs text-neutral-500 mb-1";
const SECTION_TITLE_CLASS =
  "text-[11px] font-medium text-neutral-400 uppercase tracking-wider";

function ProviderSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
      <option value="ollama">Ollama (local / free)</option>
      <option value="openai">OpenAI</option>
      <option value="anthropic">Anthropic</option>
      <option value="azure">Azure OpenAI</option>
    </select>
  );
}

function NewRunForm() {
  const router = useRouter();
  const [selectedBenchmark, setSelectedBenchmark] = useState<string>("");
  const [projectName, setProjectName] = useState("");

  // ── Backend / mem0 ───────────────────────────────────────────────────────
  const [mem0Host, setMem0Host] = useState("http://127.0.0.1:8888");
  const [backend, setBackend] = useState<"oss" | "cloud">("oss");

  // ── LLM config ───────────────────────────────────────────────────────────
  const [provider, setProvider] = useState("ollama");
  const [baseUrl, setBaseUrl] = useState("http://0.0.0.0:11434/v1");
  const [apiKey, setApiKey] = useState("ollama");
  const [answererModel, setAnswererModel] = useState("llama3.2");

  const [judgeProvider, setJudgeProvider] = useState("ollama");
  const [judgeBaseUrl, setJudgeBaseUrl] = useState("http://0.0.0.0:11434/v1");
  const [judgeApiKey, setJudgeApiKey] = useState("ollama");
  const [judgeModel, setJudgeModel] = useState("llama3.2");
  const [separateJudge, setSeparateJudge] = useState(false);

  // ── Retrieval config ──────────────────────────────────────────────────────
  const [topK, setTopK] = useState(200);
  const [topKCutoffs, setTopKCutoffs] = useState("10,20,50,200");

  // ── Benchmark-specific: LOCOMO ────────────────────────────────────────────
  const [locomoConvs, setLocomoConvs] = useState<number[]>([0]);
  const [locomoMaxQ, setLocomoMaxQ] = useState<string>("");

  // ── Benchmark-specific: LongMemEval ──────────────────────────────────────
  const [lmeMode, setLmeMode] = useState<"retrieval" | "answerer">("answerer");
  const [lmeAllQuestions, setLmeAllQuestions] = useState(true);
  const [lmePerType, setLmePerType] = useState(20);

  // ── Benchmark-specific: BEAM ──────────────────────────────────────────────
  const [beamChatSizes, setBeamChatSizes] = useState<string[]>(["100K"]);
  const [beamConvStart, setBeamConvStart] = useState(0);
  const [beamConvEnd, setBeamConvEnd] = useState(10);

  // ── Advanced ──────────────────────────────────────────────────────────────
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [envStr, setEnvStr] = useState("{}");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // When provider changes, auto-fill model + base_url defaults
  function handleProviderChange(v: string) {
    setProvider(v);
    const d = PROVIDER_DEFAULTS[v];
    if (d) {
      setAnswererModel(d.model);
      setBaseUrl(d.defaultBaseUrl);
      setApiKey(v === "ollama" ? "ollama" : "");
    }
    if (!separateJudge) {
      setJudgeProvider(v);
      const d2 = PROVIDER_DEFAULTS[v];
      if (d2) {
        setJudgeModel(d2.model);
        setJudgeBaseUrl(d2.defaultBaseUrl);
        setJudgeApiKey(v === "ollama" ? "ollama" : "");
      }
    }
  }

  function handleJudgeProviderChange(v: string) {
    setJudgeProvider(v);
    const d = PROVIDER_DEFAULTS[v];
    if (d) {
      setJudgeModel(d.model);
      setJudgeBaseUrl(d.defaultBaseUrl);
      setJudgeApiKey(v === "ollama" ? "ollama" : "");
    }
  }

  function toggleConv(idx: number) {
    setLocomoConvs((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx].sort()
    );
  }

  function toggleBeamSize(size: string) {
    setBeamChatSizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const envOverrides = JSON.parse(envStr);

      const config: Record<string, unknown> = {
        // mem0 backend
        backend,
        mem0_host: mem0Host,
        // LLM
        provider,
        answerer_model: answererModel,
        judge_model: separateJudge ? judgeModel : answererModel,
        judge_provider: separateJudge ? judgeProvider : provider,
        // Retrieval
        top_k: topK,
        top_k_cutoffs: topKCutoffs,
        output_dir: `results/${selectedBenchmark}`,
        resume: true,
      };

      // Only pass base_url / api_key if non-empty
      if (baseUrl) config.base_url = baseUrl;
      if (apiKey) config.api_key = apiKey;
      if (separateJudge) {
        if (judgeBaseUrl) config.judge_base_url = judgeBaseUrl;
        if (judgeApiKey)  config.judge_api_key  = judgeApiKey;
      }

      if (selectedBenchmark === "locomo") {
        config.conversations = locomoConvs.join(",");
        if (locomoMaxQ) config.max_questions = parseInt(locomoMaxQ);
      } else if (selectedBenchmark === "longmemeval") {
        config.mode = lmeMode;
        config.all_questions = lmeAllQuestions;
        if (!lmeAllQuestions) config.per_type = lmePerType;
      } else if (selectedBenchmark === "beam") {
        config.chat_sizes = beamChatSizes.join(",");
        config.conversations = `${beamConvStart}-${beamConvEnd - 1}`;
      }

      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selectedBenchmark,
          project_name: projectName,
          config,
          env_overrides: envOverrides,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create run");
      }

      const run = await res.json();
      router.push(`/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  }

  const showBaseUrl = PROVIDER_DEFAULTS[provider]?.needsBaseUrl ?? false;
  const showJudgeBaseUrl =
    separateJudge && (PROVIDER_DEFAULTS[judgeProvider]?.needsBaseUrl ?? false);

  return (
    <div className="max-w-2xl animate-in">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-600 mb-6"
      >
        <ArrowLeft size={14} />
        Back
      </Link>

      <div className="mb-8">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          New Benchmark Run
        </h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          Select a benchmark and configure your evaluation
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Benchmark selector */}
        <div className="grid grid-cols-3 gap-4">
          {BENCHMARKS.map((bench) => (
            <button
              key={bench.id}
              type="button"
              onClick={() => setSelectedBenchmark(bench.id)}
              className={`text-left rounded-xl border p-5 cursor-pointer transition-all duration-150 ${
                selectedBenchmark === bench.id
                  ? "border-indigo-500 bg-indigo-50/30 ring-1 ring-indigo-500/20"
                  : "bg-white hover:border-neutral-300"
              }`}
            >
              <div className="text-sm font-semibold text-neutral-900">
                {bench.name}
              </div>
              <p className="text-[13px] text-neutral-500 mt-2 leading-relaxed">
                {bench.description}
              </p>
              <div className="mt-3 space-y-0.5">
                {bench.stats.map((stat) => (
                  <div key={stat} className="text-[11px] text-neutral-400 font-mono">
                    {stat}
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>

        {/* Configuration section */}
        {selectedBenchmark && (
          <div className="animate-in rounded-xl border bg-white p-6 space-y-7">

            {/* Project Name */}
            <div className="space-y-1.5">
              <label className={LABEL_CLASS} style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>
                Project Name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className={INPUT_CLASS}
                placeholder="e.g. db2-llama32-smoke"
                required
              />
            </div>

            {/* ── BACKEND ─────────────────────────────────────────── */}
            <div className="space-y-3">
              <h3 className={SECTION_TITLE_CLASS}>mem0 Backend</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={LABEL_CLASS}>Backend mode</label>
                  <select
                    value={backend}
                    onChange={(e) => setBackend(e.target.value as "oss" | "cloud")}
                    className={SELECT_CLASS}
                  >
                    <option value="oss">OSS (self-hosted)</option>
                    <option value="cloud">Cloud (api.mem0.ai)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={LABEL_CLASS}>mem0 server URL</label>
                  <input
                    type="text"
                    value={mem0Host}
                    onChange={(e) => setMem0Host(e.target.value)}
                    className={`${INPUT_CLASS} font-mono`}
                    placeholder="http://127.0.0.1:8888"
                  />
                </div>
              </div>
              {backend === "oss" && (
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  Make sure the mem0 server is running:{" "}
                  <span className="font-mono bg-neutral-100 px-1 py-0.5 rounded">
                    bash launch.sh stop && MEM0_CONFIG_PATH=./mem0-config.yaml …
                  </span>
                </p>
              )}
            </div>

            {/* ── ANSWERER LLM ─────────────────────────────────────── */}
            <div className="space-y-3">
              <h3 className={SECTION_TITLE_CLASS}>Answerer LLM</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={LABEL_CLASS}>Provider</label>
                  <ProviderSelect value={provider} onChange={handleProviderChange} />
                </div>
                <div className="space-y-1.5">
                  <label className={LABEL_CLASS}>Model</label>
                  <input
                    type="text"
                    value={answererModel}
                    onChange={(e) => setAnswererModel(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="llama3.2"
                  />
                </div>
                {showBaseUrl && (
                  <>
                    <div className="space-y-1.5">
                      <label className={LABEL_CLASS}>Base URL</label>
                      <input
                        type="text"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        className={`${INPUT_CLASS} font-mono`}
                        placeholder="http://0.0.0.0:11434/v1"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className={LABEL_CLASS}>API Key</label>
                      <input
                        type="text"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder="ollama"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── JUDGE LLM ────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className={SECTION_TITLE_CLASS}>Judge LLM</h3>
                <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-500">
                  <input
                    type="checkbox"
                    checked={separateJudge}
                    onChange={(e) => setSeparateJudge(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-neutral-300"
                  />
                  Use different model than answerer
                </label>
              </div>
              {separateJudge ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className={LABEL_CLASS}>Provider</label>
                    <ProviderSelect value={judgeProvider} onChange={handleJudgeProviderChange} />
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLASS}>Model</label>
                    <input
                      type="text"
                      value={judgeModel}
                      onChange={(e) => setJudgeModel(e.target.value)}
                      className={INPUT_CLASS}
                      placeholder="llama3.2"
                    />
                  </div>
                  {showJudgeBaseUrl && (
                    <>
                      <div className="space-y-1.5">
                        <label className={LABEL_CLASS}>Base URL</label>
                        <input
                          type="text"
                          value={judgeBaseUrl}
                          onChange={(e) => setJudgeBaseUrl(e.target.value)}
                          className={`${INPUT_CLASS} font-mono`}
                          placeholder="http://0.0.0.0:11434/v1"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className={LABEL_CLASS}>API Key</label>
                        <input
                          type="text"
                          value={judgeApiKey}
                          onChange={(e) => setJudgeApiKey(e.target.value)}
                          className={INPUT_CLASS}
                          placeholder="ollama"
                        />
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-[12px] text-neutral-400">
                  Same as answerer —{" "}
                  <span className="font-mono text-neutral-500">{provider} / {answererModel}</span>
                </p>
              )}
            </div>

            {/* ── RETRIEVAL ────────────────────────────────────────── */}
            <div className="space-y-3">
              <h3 className={SECTION_TITLE_CLASS}>Retrieval</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={LABEL_CLASS}>Top K (memories fetched)</label>
                  <input
                    type="number"
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value) || 0)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={LABEL_CLASS}>Top K Cutoffs (for scoring)</label>
                  <input
                    type="text"
                    value={topKCutoffs}
                    onChange={(e) => setTopKCutoffs(e.target.value)}
                    className={`${INPUT_CLASS} font-mono`}
                    placeholder="10,20,50,200"
                  />
                </div>
              </div>
            </div>

            {/* ── BENCHMARK-SPECIFIC: LOCOMO ───────────────────────── */}
            {selectedBenchmark === "locomo" && (
              <div className="space-y-3">
                <h3 className={SECTION_TITLE_CLASS}>LOCOMO Options</h3>
                <div>
                  <label className={LABEL_CLASS}>Conversations (0–9)</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleConv(idx)}
                        className={`w-10 h-10 rounded-lg text-sm font-medium border transition-all ${
                          locomoConvs.includes(idx)
                            ? "bg-indigo-600 border-indigo-600 text-white"
                            : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
                        }`}
                      >
                        {idx}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={LABEL_CLASS}>
                    Max Questions per conversation{" "}
                    <span className="text-neutral-400">(blank = all)</span>
                  </label>
                  <input
                    type="number"
                    value={locomoMaxQ}
                    onChange={(e) => setLocomoMaxQ(e.target.value)}
                    className={`${INPUT_CLASS} w-40`}
                    placeholder="e.g. 10 for smoke"
                    min={1}
                  />
                </div>
              </div>
            )}

            {/* ── BENCHMARK-SPECIFIC: LongMemEval ─────────────────── */}
            {selectedBenchmark === "longmemeval" && (
              <div className="space-y-3">
                <h3 className={SECTION_TITLE_CLASS}>LongMemEval Options</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className={LABEL_CLASS}>Mode</label>
                    <select
                      value={lmeMode}
                      onChange={(e) => setLmeMode(e.target.value as "retrieval" | "answerer")}
                      className={SELECT_CLASS}
                    >
                      <option value="answerer">Answerer</option>
                      <option value="retrieval">Retrieval</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLASS}>Per Type Count</label>
                    <input
                      type="number"
                      value={lmePerType}
                      onChange={(e) => setLmePerType(parseInt(e.target.value) || 0)}
                      disabled={lmeAllQuestions}
                      className={`${INPUT_CLASS} disabled:bg-neutral-50 disabled:text-neutral-400`}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lmeAllQuestions}
                    onChange={(e) => setLmeAllQuestions(e.target.checked)}
                    className="w-4 h-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-neutral-700">All Questions</span>
                </label>
              </div>
            )}

            {/* ── BENCHMARK-SPECIFIC: BEAM ─────────────────────────── */}
            {selectedBenchmark === "beam" && (
              <div className="space-y-3">
                <h3 className={SECTION_TITLE_CLASS}>BEAM Options</h3>
                <div>
                  <label className={LABEL_CLASS}>Chat Sizes</label>
                  <div className="flex gap-2 mt-1">
                    {["100K", "500K", "1M", "10M"].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => toggleBeamSize(size)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                          beamChatSizes.includes(size)
                            ? "bg-indigo-600 border-indigo-600 text-white"
                            : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className={LABEL_CLASS}>Conversation Start</label>
                    <input
                      type="number"
                      value={beamConvStart}
                      onChange={(e) => setBeamConvStart(parseInt(e.target.value) || 0)}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL_CLASS}>Conversation End</label>
                    <input
                      type="number"
                      value={beamConvEnd}
                      onChange={(e) => setBeamConvEnd(parseInt(e.target.value) || 0)}
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── ADVANCED ─────────────────────────────────────────── */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 font-medium transition-colors"
              >
                {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Environment overrides (API keys, secrets)
              </button>
              {showAdvanced && (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] text-neutral-400">
                    JSON object of env vars injected into the benchmark process.
                    Use for API keys you don&apos;t want in the form.
                  </p>
                  <textarea
                    value={envStr}
                    onChange={(e) => setEnvStr(e.target.value)}
                    rows={4}
                    className={`${INPUT_CLASS} font-mono leading-relaxed`}
                    placeholder='{"OPENAI_API_KEY": "sk-..."}'
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Submit */}
        {selectedBenchmark && (
          <div className="flex items-center justify-between pt-2">
            <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-600">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || !selectedBenchmark || !projectName}
              className="px-5 py-2.5 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-white text-sm font-medium rounded-lg"
            >
              {submitting ? "Starting..." : "Start Run"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

export default function NewRunPage() {
  return (
    <Suspense>
      <NewRunForm />
    </Suspense>
  );
}
