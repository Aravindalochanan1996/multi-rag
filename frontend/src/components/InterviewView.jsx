import { useEffect, useState } from "react";
import { cachedInterview, generateInterview } from "../api.js";

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

function Evidence({ item }) {
  if (item.resume_evidence) {
    return <p className="mt-2 border-l-2 border-emerald-300 pl-2 text-xs text-slate-600">From your resume: “{item.resume_evidence}”</p>;
  }
  if (item.evidence_verified === false) {
    return <p className="mt-2 text-xs text-amber-700">The model cited resume text that could not be found, so it was removed.</p>;
  }
  return null;
}

function Card({ tone, children }) {
  const border = { tech: "border-indigo-300", gap: "border-rose-300", beh: "border-amber-300", ask: "border-emerald-300" }[tone];
  return <li className={`rounded-lg border-l-4 ${border} bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200`}>{children}</li>;
}

function Group({ title, hint, count, children }) {
  if (!count) return null;
  return (
    <section className="mt-5">
      <h4 className="text-sm font-semibold">{title} <span className="font-normal text-slate-400">({count})</span></h4>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function Kit({ kit }) {
  return (
    <div>
      <Group title="Technical questions" hint="Likely questions on the role's key requirements, with points to make." count={kit.technical.length}>
        {kit.technical.map((q, i) => (
          <Card key={i} tone="tech">
            <p className="font-medium">{q.question}</p>
            {q.why && <p className="mt-1 text-xs text-slate-500">Why they ask: {q.why}</p>}
            {q.talking_points.length > 0 && (
              <>
                <p className="mt-2 text-xs font-medium text-slate-500">Suggested points <span className="font-normal">(AI-written: only use what is true for you)</span></p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">{q.talking_points.map((p, j) => <li key={j}>{p}</li>)}</ul>
              </>
            )}
            <Evidence item={q} />
          </Card>
        ))}
      </Group>
      <Group title="Gap questions" hint="Where your resume doesn't show a requirement. Be honest, then show how you'd close the gap." count={kit.gaps.length}>
        {kit.gaps.map((q, i) => (
          <Card key={i} tone="gap">
            <p className="font-medium">{q.question}</p>
            {q.gap && <span className="mt-1 inline-block rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">Gap: {q.gap}</span>}
            {q.how_to_answer && <p className="mt-2 text-slate-700">{q.how_to_answer}</p>}
          </Card>
        ))}
      </Group>
      <Group title="Behavioural (STAR)" hint="Pick a real story from your experience; Situation → Task → Action → Result." count={kit.behavioral.length}>
        {kit.behavioral.map((q, i) => (
          <Card key={i} tone="beh">
            <p className="font-medium">{q.question}</p>
            {q.star_hint && <p className="mt-1 text-slate-700">{q.star_hint}</p>}
            <Evidence item={q} />
          </Card>
        ))}
      </Group>
      <Group title="Questions to ask them" hint="Shows you've thought about the role." count={kit.ask_them.length}>
        {kit.ask_them.map((q, i) => <Card key={i} tone="ask">{q}</Card>)}
      </Group>
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
    return <p className="mt-16 text-center text-slate-500">Upload your resume and a job posting to get an interview prep kit.</p>;
  }

  return (
    <div className="space-y-4 p-6">
      {jobs.map((job) => {
        const kit = kits[job.id];
        return (
          <article key={job.id} className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-medium">{job.title}</h3>
              <div className="flex gap-2">
                {kit && (
                  <button onClick={() => copy(job, kit)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:border-indigo-400">
                    {copied === job.id ? "Copied ✓" : "Copy as text"}
                  </button>
                )}
                <button onClick={() => run(job, Boolean(kit))} disabled={loading[job.id]}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
                  {loading[job.id] ? "Preparing…" : kit ? "Regenerate" : "Generate prep kit"}
                </button>
              </div>
            </div>
            {loading[job.id] && (
              <p className="mt-2 text-xs text-slate-500">
                Writing questions tailored to your resume{progress[job.id] ? ` (${progress[job.id]} chunks received)` : ""}. A local model can take a few minutes.
              </p>
            )}
            {errors[job.id] && <p role="alert" className="mt-2 text-sm text-red-600">{errors[job.id]}</p>}
            {kit && <Kit kit={kit} />}
          </article>
        );
      })}
    </div>
  );
}
