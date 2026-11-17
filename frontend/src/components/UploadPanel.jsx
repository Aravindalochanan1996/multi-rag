import { useRef, useState } from "react";
import { uploadDocument, deleteDocument, importFromUrl } from "../api.js";

const ACCEPT = ".pdf,.docx,.txt,.md";

function Section({ title, docType, docs, onChanged, allowJobInputs }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(null); // null | "paste" | "url"
  const [pasted, setPasted] = useState("");
  const [url, setUrl] = useState("");

  async function run(task) {
    setBusy(true);
    setError("");
    try {
      await task();
      await onChanged();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const upload = (file) => run(() => uploadDocument(file, docType));

  async function submitPaste() {
    if (!pasted.trim()) return;
    const ok = await upload(new File([pasted], "pasted-job-description.txt", { type: "text/plain" }));
    if (ok) { setPasted(""); setMode(null); }
  }

  async function submitUrl() {
    if (!url.trim()) return;
    const ok = await run(() => importFromUrl(url.trim(), docType));
    if (ok) { setUrl(""); setMode(null); }
  }

  const toggle = (m) => setMode((cur) => (cur === m ? null : m));
  const chip = (m) =>
    `rounded-md border px-3 py-2 text-sm hover:border-indigo-400 ${mode === m ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-600"}`;

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <ul className="space-y-1">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200">
            <span className="flex-1 truncate" title={d.title}>{d.title}</span>
            <span className="text-xs text-slate-400">{d.chunk_count} chunks</span>
            <button
              aria-label={`Remove ${d.title}`}
              className="text-slate-400 hover:text-red-600"
              onClick={async () => { await deleteDocument(d.id); await onChanged(); }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <input ref={input} type="file" accept={ACCEPT} hidden
        onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => input.current.click()}
          className="flex-1 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50">
          {busy ? "Processing…" : "+ Upload file"}
        </button>
        {allowJobInputs && (
          <>
            <button onClick={() => toggle("url")} className={chip("url")}>Link</button>
            <button onClick={() => toggle("paste")} className={chip("paste")}>Paste</button>
          </>
        )}
      </div>
      {mode === "url" && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); submitUrl(); }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" inputMode="url"
            placeholder="https://company.com/careers/job-123"
            className="w-full rounded-md border border-slate-300 p-2 text-sm" />
          <div className="flex items-center gap-2">
            <button disabled={busy || !url.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? "Importing…" : "Import job"}
            </button>
            <span className="text-xs text-slate-400">Public pages only. If a site blocks us, use Paste.</span>
          </div>
        </form>
      )}
      {mode === "paste" && (
        <div className="space-y-2">
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6}
            placeholder="Paste the job description text…"
            className="w-full rounded-md border border-slate-300 p-2 text-sm" />
          <button onClick={submitPaste} disabled={busy}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
            Add job
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

export default function UploadPanel({ docs, onChanged }) {
  return (
    <div className="space-y-6">
      <Section title="Your resume" docType="resume" docs={docs.filter((d) => d.doc_type === "resume")} onChanged={onChanged} />
      <Section title="Job postings" docType="job" docs={docs.filter((d) => d.doc_type === "job")} onChanged={onChanged} allowJobInputs />
    </div>
  );
}
