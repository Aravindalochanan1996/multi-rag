import { useEffect, useState } from "react";
import { cachedInterview, generateInterview } from "../api.js";
import { Alert, Badge, Button, Card, Icon, IndeterminateBar, Skeleton } from "./ui.jsx";

/** Plain-text version of a kit, for copying into notes. */
function kitToText(kit) {
  const lines = [`Interview prep: ${kit.title}`, ""];
  const section = (name, items, render) => {
    if (!items.length) return;
    lines.push(name.toUpperCase());
    items.forEach((it, i) => lines.push(...render(it, i + 1), ""));
  };
  section("Technical questions", kit.technical, (q, n) => [
    `${n}. ${q.question}`, q.why && `   Why they ask: ${q.why}`,
    ...q.talking_points.map((p) => `   - ${p}`), q.resume_evidence && `   Your resume: "${q.resume_evidence}"`,
  ].filter(Boolean));
  section("Gap questions", kit.gaps, (q, n) => [
    `${n}. ${q.question}`, q.gap && `   Gap: ${q.gap}`, q.how_to_answer && `   How to answer: ${q.how_to_answer}`,
  ].filter(Boolean));
  section("Behavioural (STAR)", kit.behavioral, (q, n) => [
    `${n}. ${q.question}`, q.star_hint && `   ${q.star_hint}`, q.resume_evidence && `   Your resume: "${q.resume_evidence}"`,
  ].filter(Boolean));
  section("Questions to ask them", kit.ask_them.map((q) => ({ q })), (it, n) => [`${n}. ${it.q}`]);
  return lines.join("\n");
}

const GROUPS = [
  { id: "technical", label: "Technical", icon: "target", tone: "brand", hint: "Likely questions on the role's key requirements, with points to make." },
  { id: "gaps", label: "Gaps", icon: "alert", tone: "bad", hint: "Where your resume doesn't show a requirement. Be honest, then show how you'd close the gap." },
  { id: "behavioral", label: "Behavioural", icon: "users", tone: "warn", hint: "Pick a real story from your experience: Situation → Task → Action → Result." },
  { id: "ask_them", label: "Ask them", icon: "question", tone: "ok", hint: "Thoughtful questions show you've considered the role." },
];

const ACCENT = { brand: "bg-brand-soft text-brand-text", bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn", ok: "bg-ok-soft text-ok" };

function Evidence({ item }) {
  if (item.resume_evidence) {
    return (
      <p className="mt-3 flex gap-2 rounded-lg bg-ok-soft px-3 py-2 text-xs text-ok">
        <Icon name="check" className="mt-0.5 h-3.5 w-3.5" strokeWidth="2.6" />
        <span><b>From your resume:</b> “{item.resume_evidence}”</span>
      </p>
    );
  }
  if (item.evidence_verified === false) {
    return <p className="mt-3 text-xs text-warn">The model cited resume text that could not be found, so it was removed.</p>;
  }
  return null;
}

function Question({ n, tone, open, children, question }) {
  return (
    <details open={open} className="group animate-fade-up overflow-hidden rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 text-sm marker:hidden hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
        <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${ACCENT[tone]}`}>{n}</span>
        <span className="flex-1 font-medium leading-snug">{question}</span>
        <Icon name="chevron" className="mt-1 h-4 w-4 text-muted transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-4 pb-4 pt-3 pl-[3.25rem] text-sm">{children}</div>
    </details>
  );
}

function Kit({ kit }) {
  const [active, setActive] = useState("technical");
  const group = GROUPS.find((g) => g.id === active);
  const items = kit[active];
  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {GROUPS.map((g) => (
          <button key={g.id} role="tab" aria-selected={active === g.id} onClick={() => setActive(g.id)} disabled={!kit[g.id].length}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${active === g.id ? "brand-gradient text-white shadow-brand" : "bg-surface-2 text-muted hover:text-text"}`}>
            <Icon name={g.icon} className="h-3.5 w-3.5" />{g.label}
            <span className="opacity-75">{kit[g.id].length}</span>
          </button>
        ))}
      </div>
      <p className="mb-3 mt-3 text-xs text-muted">{group.hint}</p>
      <div className="space-y-2">
        {active === "technical" && items.map((q, i) => (
          <Question key={i} n={i + 1} tone="brand" open={i === 0} question={q.question}>
            {q.why && <p className="text-xs text-muted">Why they ask: {q.why}</p>}
            {q.talking_points.length > 0 && (
              <>
                <p className="mt-3 text-xs font-medium text-muted">Suggested points <span className="font-normal">(AI-written: only use what is true for you)</span></p>
                <ul className="mt-1 list-disc space-y-1 pl-5 marker:text-brand">{q.talking_points.map((p, j) => <li key={j}>{p}</li>)}</ul>
              </>
            )}
            <Evidence item={q} />
          </Question>
        ))}
        {active === "gaps" && items.map((q, i) => (
          <Question key={i} n={i + 1} tone="bad" open={i === 0} question={q.question}>
            {q.gap && <Badge tone="bad">Gap: {q.gap}</Badge>}
            {q.how_to_answer && <p className="mt-2 leading-relaxed">{q.how_to_answer}</p>}
          </Question>
        ))}
        {active === "behavioral" && items.map((q, i) => (
          <Question key={i} n={i + 1} tone="warn" open={i === 0} question={q.question}>
            {q.star_hint && <p className="leading-relaxed">{q.star_hint}</p>}
            <Evidence item={q} />
          </Question>
        ))}
        {active === "ask_them" && items.map((q, i) => (
          <div key={i} className="animate-fade-up flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
            <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${ACCENT.ok}`}>{i + 1}</span>
            <span className="leading-snug">{q}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InterviewView({ docs }) {
  const jobs = docs.filter((d) => d.doc_type === "job");
  const hasResume = docs.some((d) => d.doc_type === "resume");
  const [kits, setKits] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [progress, setProgress] = useState({});
  const [copied, setCopied] = useState("");

  const jobKey = jobs.map((j) => j.id).join(",");
  useEffect(() => {
    jobs.forEach(async (job) => {
      try {
        const saved = await cachedInterview(job.id);
        if (saved) setKits((k) => (k[job.id] ? k : { ...k, [job.id]: saved }));
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
      await generateInterview(job.id, (e) => {
        if (e.type === "result") setKits((k) => ({ ...k, [job.id]: e.result }));
        else if (e.type === "progress") setProgress((p) => ({ ...p, [job.id]: e.chunks }));
        else if (e.type === "error") setErrors((x) => ({ ...x, [job.id]: e.message }));
      }, refresh);
    } catch (err) {
      setErrors((e) => ({ ...e, [job.id]: err.message }));
    } finally {
      setLoading((l) => ({ ...l, [job.id]: false }));
    }
  }

  async function copy(job, kit) {
    try {
      await navigator.clipboard.writeText(kitToText(kit));
      setCopied(job.id);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setErrors((e) => ({ ...e, [job.id]: "Could not copy to the clipboard in this browser." }));
    }
  }

  if (!hasResume || jobs.length === 0) {
    return (
      <div className="animate-fade-up mx-auto mt-20 max-w-sm text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-text"><Icon name="users" className="h-6 w-6" /></span>
        <h2 className="mt-4 text-lg font-semibold">Prepare for the interview</h2>
        <p className="mt-1 text-sm text-muted">Add your resume and a job posting to get tailored technical, gap and behavioural questions.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Interview prep</h2>
        <p className="text-sm text-muted">Questions tailored to your resume for each role, with honest coaching on the gaps.</p>
      </div>
      {jobs.map((job) => {
        const kit = kits[job.id];
        return (
          <Card key={job.id} className="animate-fade-up p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-text"><Icon name="briefcase" className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold" title={job.title}>{job.title}</h3>
                <p className="text-xs text-muted">{kit ? "Your prep kit is ready" : "Generate a kit of likely questions"}</p>
              </div>
              {kit && (
                <Button variant="secondary" icon={copied === job.id ? "check" : "copy"} onClick={() => copy(job, kit)}>
                  {copied === job.id ? "Copied" : "Copy as text"}
                </Button>
              )}
              <Button variant={kit ? "secondary" : "primary"} icon={kit ? "refresh" : "sparkles"} loading={loading[job.id]}
                onClick={() => run(job, Boolean(kit))}>
                {loading[job.id] ? "Preparing…" : kit ? "Regenerate" : "Generate prep kit"}
              </Button>
            </div>
            {loading[job.id] && (
              <div className="mt-4 space-y-2">
                <IndeterminateBar />
                <p className="text-xs text-muted">
                  Writing questions tailored to your resume{progress[job.id] ? ` · ${progress[job.id]} chunks received` : ""}. A local model can take a few minutes.
                </p>
                {!kit && <div className="space-y-2 pt-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
              </div>
            )}
            {errors[job.id] && <Alert className="mt-4" onDismiss={() => setErrors((e) => ({ ...e, [job.id]: "" }))}>{errors[job.id]}</Alert>}
            {kit && <Kit kit={kit} />}
          </Card>
        );
      })}
    </div>
  );
}
