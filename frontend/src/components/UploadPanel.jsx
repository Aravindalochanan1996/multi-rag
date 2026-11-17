import { useRef, useState } from "react";
import { uploadDocument, deleteDocument } from "../api.js";

const ACCEPT = ".pdf,.docx,.txt,.md";

function Section({ title, docType, docs, onChanged, allowPaste }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");

  async function upload(file) {
    setBusy(true);
    setError("");
    try {
      await uploadDocument(file, docType);
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPaste() {
    if (!pasted.trim()) return;
    await upload(new File([pasted], "pasted-job-description.txt", { type: "text/plain" }));
    setPasted("");
    setPasting(false);
  }

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
        {allowPaste && (
          <button onClick={() => setPasting((p) => !p)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-indigo-400">
            Paste
          </button>
        )}
      </div>
      {pasting && (
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
      <Section title="Job postings" docType="job" docs={docs.filter((d) => d.doc_type === "job")} onChanged={onChanged} allowPaste />
    </div>
  );
}
