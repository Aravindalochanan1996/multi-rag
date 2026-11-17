import { useEffect, useState } from "react";
import { analyseFit, cachedFit } from "../api.js";

const STATUS = {
  met: { label: "Met", cls: "bg-emerald-100 text-emerald-800" },
  partial: { label: "Partial", cls: "bg-amber-100 text-amber-800" },
  missing: { label: "Missing", cls: "bg-rose-100 text-rose-800" },
};

const scoreColor = (s) => (s >= 70 ? "bg-emerald-500" : s >= 40 ? "bg-amber-500" : "bg-rose-500");

function ScoreBar({ score }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${scoreColor(score)}`} style={{ width: `${score}%` }} />
      </div>
      <span className="w-12 text-right text-lg font-semibold tabular-nums">{score}%</span>
    </div>
  );
}

function GapMatrix({ result }) {
  const order = { missing: 0, partial: 1, met: 2 };
  const rows = [...result.requirements].sort(
    (a, b) => order[a.status] - order[b.status] || (a.priority === "required" ? -1 : 1),
  );
  return (
    <table className="mt-3 w-full text-left text-sm">
      <thead className="text-xs uppercase text-slate-500">
        <tr><th className="py-1 pr-2">Requirement</th><th className="px-2">Type</th><th className="px-2">Status</th><th className="pl-2">Evidence from your resume</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-slate-100 align-top">
            <td className="py-2 pr-2">{r.requirement}</td>
            <td className="px-2 text-xs text-slate-500">{r.priority}</td>
            <td className="px-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
            </td>
            <td className="pl-2 text-xs text-slate-600">
              {r.evidence ? `“${r.evidence}”` : r.verified ? "—" : "Model claimed a match but no supporting text was found"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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

  if (!hasResume || jobs.length === 0) {
    return <p className="mt-16 text-center text-slate-500">Upload your resume and a job posting to see your fit.</p>;
  }

  const ranked = [...jobs].sort((a, b) => (results[b.id]?.score ?? -1) - (results[a.id]?.score ?? -1));

  return (
    <div className="space-y-4 overflow-y-auto p-6">
      {ranked.map((job) => {
        const res = results[job.id];
        return (
          <article key={job.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">{job.title}</h3>
              <button onClick={() => run(job, Boolean(res))} disabled={loading[job.id]}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
                {loading[job.id] ? "Analysing…" : res ? "Re-run" : "Analyse fit"}
              </button>
            </div>
            {loading[job.id] && <p className="mt-2 text-xs text-slate-500">Comparing requirement by requirement{progress[job.id] ? ` (${progress[job.id]} chunks received)` : ""}. A local model can take a minute or two.</p>}
            {errors[job.id] && <p role="alert" className="mt-2 text-sm text-red-600">{errors[job.id]}</p>}
            {res && (
              <>
                <div className="mt-3"><ScoreBar score={res.score} /></div>
                <p className="mt-1 text-xs text-slate-500">
                  {res.met} met · {res.partial} partial · {res.missing} missing. Required items count double.
                </p>
                <GapMatrix result={res} />
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
