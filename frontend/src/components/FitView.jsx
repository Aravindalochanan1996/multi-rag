import { useEffect, useState } from "react";
import { analyseFit, cachedFit } from "../api.js";
import { Alert, Badge, Button, Card, Icon, IndeterminateBar, ScoreRing, Skeleton, scoreTone } from "./ui.jsx";

const STATUS = {
  met: { label: "Met", tone: "ok", icon: "check" },
  partial: { label: "Partial", tone: "warn", icon: "target" },
  missing: { label: "Missing", tone: "bad", icon: "x" },
};
const ORDER = { missing: 0, partial: 1, met: 2 };
const FILTERS = [["all", "All"], ["missing", "Missing"], ["partial", "Partial"], ["met", "Met"]];

function Leaderboard({ jobs, results, onOpen }) {
  const ranked = jobs.filter((j) => results[j.id]).sort((a, b) => results[b.id].score - results[a.id].score);
  if (ranked.length < 2) return null;
  return (
    <Card className="animate-fade-up p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon name="chart" className="h-4 w-4 text-brand" />How the jobs compare
      </h3>
      <ul className="mt-3 space-y-3">
        {ranked.map((j, i) => {
          const s = results[j.id].score;
          return (
            <li key={j.id}>
              <button onClick={() => onOpen(j.id)} className="block w-full text-left">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    {i === 0 && <Badge tone="ok">Best match</Badge>}
                    <span className="truncate font-medium">{j.title}</span>
                  </span>
                  <span className="tabular-nums font-semibold">{s}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${s}%`, background: `var(--${scoreTone(s)})` }} />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Requirements({ result }) {
  const [filter, setFilter] = useState("all");
  const counts = { all: result.requirements.length, missing: result.missing, partial: result.partial, met: result.met };
  const rows = result.requirements
    .filter((r) => filter === "all" || r.status === filter)
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.priority === "required" ? -1 : 1));
  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} disabled={counts[id] === 0}
            className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-40 ${filter === id ? "brand-gradient text-white" : "bg-surface-2 text-muted hover:text-text"}`}>
            {label} <span className="opacity-70">{counts[id]}</span>
          </button>
        ))}
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {rows.map((r, i) => {
          const st = STATUS[r.status];
          return (
            <li key={i} className="flex gap-3 bg-surface px-4 py-3 text-sm">
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${st.tone === "ok" ? "bg-ok-soft text-ok" : st.tone === "warn" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad"}`}>
                <Icon name={st.icon} className="h-3.5 w-3.5" strokeWidth="2.6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.requirement}</span>
                  <Badge tone={r.priority === "required" ? "brand" : "neutral"}>{r.priority === "required" ? "Required" : "Nice to have"}</Badge>
                </div>
                {r.evidence ? (
                  <p className="mt-1 border-l-2 border-ok/50 pl-2 text-xs italic text-muted">“{r.evidence}”</p>
                ) : !r.verified ? (
                  <p className="mt-1 text-xs text-warn">The model claimed a match but no supporting text was found in your resume.</p>
                ) : (
                  <p className="mt-1 text-xs text-muted">Not found in your resume.</p>
                )}
              </div>
              <Badge tone={st.tone === "ok" ? "ok" : st.tone === "warn" ? "warn" : "bad"} className="h-fit shrink-0">{st.label}</Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function FitView({ docs }) {
  const jobs = docs.filter((d) => d.doc_type === "job");
  const hasResume = docs.some((d) => d.doc_type === "resume");
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [progress, setProgress] = useState({});

  // Show previously computed analyses immediately instead of re-running the model.
  const jobKey = jobs.map((j) => j.id).join(",");
  useEffect(() => {
    jobs.forEach(async (job) => {
      try {
        const saved = await cachedFit(job.id);
        if (saved) setResults((r) => (r[job.id] ? r : { ...r, [job.id]: saved }));
      } catch {
        /* cache is an optimisation; ignore failures */
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey, hasResume]);

  async function run(job, refresh = false) {
    setLoading((l) => ({ ...l, [job.id]: true }));
    setErrors((e) => ({ ...e, [job.id]: "" }));
    try {
      await analyseFit(job.id, (e) => {
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

  async function runAll() {
    for (const job of jobs.filter((j) => !results[j.id])) await run(job);
  }

  const open = (id) => document.getElementById(`fit-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (!hasResume || jobs.length === 0) {
    return (
      <div className="animate-fade-up mx-auto mt-20 max-w-sm text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-text"><Icon name="chart" className="h-6 w-6" /></span>
        <h2 className="mt-4 text-lg font-semibold">See how well you fit</h2>
        <p className="mt-1 text-sm text-muted">Add your resume and at least one job posting to get a score, evidence and a skill-gap breakdown.</p>
      </div>
    );
  }

  const pending = jobs.filter((j) => !results[j.id]);
  const anyLoading = Object.values(loading).some(Boolean);
  const ranked = [...jobs].sort((a, b) => (results[b.id]?.score ?? -1) - (results[a.id]?.score ?? -1));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Fit & skill gaps</h2>
          <p className="text-sm text-muted">Each requirement is checked against your resume, with the evidence quoted. Required items count double.</p>
        </div>
        {pending.length > 1 && (
          <Button variant="primary" icon="sparkles" onClick={runAll} loading={anyLoading}>Analyse all {pending.length} jobs</Button>
        )}
      </div>

      <Leaderboard jobs={jobs} results={results} onOpen={open} />

      {ranked.map((job) => {
        const res = results[job.id];
        return (
          <Card key={job.id} id={`fit-${job.id}`} className="animate-fade-up scroll-mt-4 p-5">
            <div className="flex flex-wrap items-center gap-4">
              {res ? <ScoreRing score={res.score} /> : loading[job.id] ? <Skeleton className="h-[84px] w-[84px] rounded-full" /> : (
                <span className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-full border-2 border-dashed border-border text-muted"><Icon name="target" className="h-6 w-6" /></span>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold" title={job.title}>{job.title}</h3>
                {res ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone="ok">{res.met} met</Badge>
                    <Badge tone="warn">{res.partial} partial</Badge>
                    <Badge tone="bad">{res.missing} missing</Badge>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted">{loading[job.id] ? "Reading the posting and your resume…" : "Not analysed yet."}</p>
                )}
              </div>
              <Button variant={res ? "secondary" : "primary"} icon={res ? "refresh" : "sparkles"} loading={loading[job.id]}
                onClick={() => run(job, Boolean(res))}>
                {loading[job.id] ? "Analysing…" : res ? "Re-run" : "Analyse fit"}
              </Button>
            </div>

            {loading[job.id] && (
              <div className="mt-4 space-y-2">
                <IndeterminateBar />
                <p className="text-xs text-muted">
                  Comparing requirement by requirement{progress[job.id] ? ` · ${progress[job.id]} chunks received` : ""}. A local model can take a minute or two.
                </p>
                {!res && <div className="space-y-2 pt-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
              </div>
            )}
            {errors[job.id] && <Alert className="mt-4" onDismiss={() => setErrors((e) => ({ ...e, [job.id]: "" }))}>{errors[job.id]}</Alert>}
            {res && <Requirements result={res} />}
          </Card>
        );
      })}
    </div>
  );
}
