import { useEffect, useState } from "react";
import { cachedSuggestions, generateSuggestions } from "../api.js";
import { Alert, Badge, Button, Card, Icon, IndeterminateBar, Skeleton } from "./ui.jsx";

const CATEGORIES = {
  rewrite: { label: "Rewrite", icon: "sparkles" },
  quantify: { label: "Add numbers", icon: "chart" },
  keywords: { label: "Keywords", icon: "target" },
  structure: { label: "Structure", icon: "file" },
  gap: { label: "Skill gap", icon: "alert" },
  advice: { label: "Advice", icon: "lightbulb" },
};
const PRIORITY = {
  high: { label: "High impact", tone: "bad", bar: "bg-bad" },
  medium: { label: "Medium", tone: "warn", bar: "bg-warn" },
  low: { label: "Nice to have", tone: "neutral", bar: "bg-border" },
};

/** Plain-text export of the suggestions, for pasting into notes. */
function toText(result) {
  const lines = [`Resume suggestions for: ${result.title}`, result.summary, ""];
  result.suggestions.forEach((s, i) => {
    lines.push(`${i + 1}. [${PRIORITY[s.priority].label}] ${s.title}`);
    if (s.issue) lines.push(`   Issue: ${s.issue}`);
    if (s.original) lines.push(`   Now: ${s.original}`);
    lines.push(`   ${s.original ? "Suggested: " : ""}${s.suggestion}`);
    if (s.needs_input.length) lines.push(`   Fill in: ${s.needs_input.join("; ")}`);
    lines.push("");
  });
  return lines.join("\n");
}

function Warnings({ s }) {
  const w = s.warnings;
  const notes = [];
  if (w.new_numbers.length) {
    notes.push(`Contains figures that are not on your resume (${w.new_numbers.join(", ")}). Replace them with your real numbers or remove them.`);
  }
  if (w.unsupported_claims?.length) {
    notes.push(`Claims results your resume doesn't state (${w.unsupported_claims.join(", ")}). Remove them, or replace with what really happened.`);
  }
  if (w.added_terms.length) {
    notes.push(`Mentions terms from the job that your resume doesn't show (${w.added_terms.join(", ")}). Only keep them if they're true for you.`);
  }
  if (w.original_missing) {
    notes.push(s.original_verified === false
      ? "The model quoted a line that isn't on your resume, so the original was removed. Check where this applies."
      : "No matching line on your resume was identified. Check where this applies.");
  }
  if (!notes.length) return null;
  return (
    <ul className="mt-3 space-y-1.5">
      {notes.map((n) => (
        <li key={n} className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" /><span>{n}</span>
        </li>
      ))}
    </ul>
  );
}

function SuggestionCard({ s, n }) {
  const [copied, setCopied] = useState(false);
  const cat = CATEGORIES[s.category];
  const pr = PRIORITY[s.priority];
  async function copy() {
    try {
      await navigator.clipboard.writeText(s.suggestion);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }
  return (
    <li className="animate-fade-up flex overflow-hidden rounded-xl border border-border bg-surface">
      <span className={`w-1 shrink-0 ${pr.bar}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted">#{n}</span>
          <Badge tone="brand"><Icon name={cat.icon} className="h-3 w-3" />{cat.label}</Badge>
          <Badge tone={pr.tone}>{pr.label}</Badge>
        </div>
        <h4 className="mt-2 font-semibold leading-snug">{s.title}</h4>
        {s.issue && <p className="mt-1 text-xs leading-relaxed text-muted">{s.issue}</p>}

        {s.original ? (
          <div className="mt-3 grid gap-2">
            <div className="rounded-lg border-l-4 border-bad/60 bg-bad-soft/60 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-bad">On your resume now</p>
              <p className="mt-0.5 leading-relaxed">{s.original}</p>
            </div>
            <div className="rounded-lg border-l-4 border-ok/60 bg-ok-soft/60 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ok">Suggested</p>
                <button onClick={copy} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface hover:text-text">
                  <Icon name={copied ? "check" : "copy"} className="h-3 w-3" />{copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-0.5 leading-relaxed">{s.suggestion}</p>
            </div>
          </div>
        ) : (
          <p className="mt-3 leading-relaxed">{s.suggestion}</p>
        )}

        {s.needs_input.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted">Fill in before using:</span>
            {s.needs_input.map((x) => <Badge key={x} tone="warn">{x}</Badge>)}
          </div>
        )}
        {s.category === "gap" && (
          <p className="mt-3 flex gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand-text">
            <Icon name="shield" className="mt-0.5 h-3.5 w-3.5" />Only add a skill to your resume if you genuinely have it.
          </p>
        )}
        <Warnings s={s} />
      </div>
    </li>
  );
}

function Suggestions({ result }) {
  const [filter, setFilter] = useState("all");
  const counts = { all: result.suggestions.length };
  result.suggestions.forEach((s) => { counts[s.category] = (counts[s.category] || 0) + 1; });
  const shown = result.suggestions.filter((s) => filter === "all" || s.category === filter);
  return (
    <div className="mt-5">
      {result.summary && (
        <p className="mb-4 flex gap-2 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand-text">
          <Icon name="lightbulb" className="mt-0.5 h-4 w-4" />{result.summary}
        </p>
      )}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {[["all", "All"], ...Object.entries(CATEGORIES).filter(([id]) => counts[id]).map(([id, c]) => [id, c.label])].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${filter === id ? "brand-gradient text-white" : "bg-surface-2 text-muted hover:text-text"}`}>
            {label} <span className="opacity-70">{counts[id]}</span>
          </button>
        ))}
      </div>
      <ul className="space-y-3">
        {shown.map((s, i) => <SuggestionCard key={`${s.title}-${i}`} s={s} n={result.suggestions.indexOf(s) + 1} />)}
      </ul>
    </div>
  );
}

export default function ResumeTipsView({ docs }) {
  const jobs = docs.filter((d) => d.doc_type === "job");
  const hasResume = docs.some((d) => d.doc_type === "resume");
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [progress, setProgress] = useState({});
  const [copied, setCopied] = useState("");

  const jobKey = jobs.map((j) => j.id).join(",");
  useEffect(() => {
    jobs.forEach(async (job) => {
      try {
        const saved = await cachedSuggestions(job.id);
        if (saved) setResults((r) => (r[job.id] ? r : { ...r, [job.id]: saved }));
      } catch {
        /* cache is an optimisation */
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey, hasResume]);

  async function run(job, refresh = false) {
    setLoading((l) => ({ ...l, [job.id]: true }));
    setErrors((e) => ({ ...e, [job.id]: "" }));
    try {
      await generateSuggestions(job.id, (e) => {
        if (e.type === "result") setResults((r) => ({ ...r, [job.id]: e.result }));
        else if (e.type === "progress") setProgress((p) => ({ ...p, [job.id]: e.chunks }));
        else if (e.type === "error") setErrors((x) => ({ ...x, [job.id]: e.message }));
      }, refresh);
    } catch (err) {
      setErrors((e) => ({ ...e, [job.id]: err.message }));
    } finally {
      setLoading((l) => ({ ...l, [job.id]: false }));
    }
  }

  async function copyAll(job, result) {
    try {
      await navigator.clipboard.writeText(toText(result));
      setCopied(job.id);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setErrors((e) => ({ ...e, [job.id]: "Could not copy to the clipboard in this browser." }));
    }
  }

  if (!hasResume || jobs.length === 0) {
    return (
      <div className="animate-fade-up mx-auto mt-20 max-w-sm text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-text"><Icon name="lightbulb" className="h-6 w-6" /></span>
        <h2 className="mt-4 text-lg font-semibold">Strengthen your resume</h2>
        <p className="mt-1 text-sm text-muted">Add your resume and a job posting to get rewrites and fixes tailored to that role.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Resume tips</h2>
        <p className="text-sm text-muted">Tailored to each job. Suggestions only use facts already on your resume, and anything that needs a number or a skill you haven't shown is flagged for you to confirm.</p>
      </div>
      {jobs.map((job) => {
        const result = results[job.id];
        return (
          <Card key={job.id} className="animate-fade-up p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-text"><Icon name="briefcase" className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold" title={job.title}>{job.title}</h3>
                <p className="text-xs text-muted">{result ? `${result.suggestions.length} suggestions for this role` : "Get suggestions for this role"}</p>
              </div>
              {result && (
                <Button variant="secondary" icon={copied === job.id ? "check" : "copy"} onClick={() => copyAll(job, result)}>
                  {copied === job.id ? "Copied" : "Copy all"}
                </Button>
              )}
              <Button variant={result ? "secondary" : "primary"} icon={result ? "refresh" : "sparkles"} loading={loading[job.id]}
                onClick={() => run(job, Boolean(result))}>
                {loading[job.id] ? "Reviewing…" : result ? "Regenerate" : "Suggest improvements"}
              </Button>
            </div>
            {loading[job.id] && (
              <div className="mt-4 space-y-2">
                <IndeterminateBar />
                <p className="text-xs text-muted">
                  Reading your resume against the posting{progress[job.id] ? ` · ${progress[job.id]} chunks received` : ""}. A local model can take a few minutes.
                </p>
                {!result && <div className="space-y-2 pt-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
              </div>
            )}
            {errors[job.id] && <Alert className="mt-4" onDismiss={() => setErrors((e) => ({ ...e, [job.id]: "" }))}>{errors[job.id]}</Alert>}
            {result && <Suggestions result={result} />}
          </Card>
        );
      })}
    </div>
  );
}
