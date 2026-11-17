import { useRef, useState } from "react";
import { uploadDocument, deleteDocument, importFromUrl } from "../api.js";
import { Alert, Badge, Button, Icon } from "./ui.jsx";

const ACCEPT = ".pdf,.docx,.txt,.md";

/** One uploaded document row. */
function DocItem({ doc, icon, onRemove }) {
  return (
    <li className="animate-fade-up group flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-text">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={doc.title}>{doc.title}</p>
        <p className="text-xs text-muted">{doc.chunk_count} sections indexed</p>
      </div>
      <button type="button" onClick={onRemove} aria-label={`Remove ${doc.title}`}
        className="rounded-lg p-1.5 text-muted opacity-60 transition hover:bg-bad-soft hover:text-bad hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100">
        <Icon name="trash" className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Drag-and-drop target that also opens the file picker on click. */
function DropZone({ onFiles, busy, multiple, compact, label, hint }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  function handle(files) {
    const list = [...files];
    if (list.length) onFiles(multiple ? list : list.slice(0, 1));
  }

  return (
    <div
      role="button" tabIndex={0}
      onClick={() => !busy && input.current.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && input.current.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) handle(e.dataTransfer.files); }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${compact ? "gap-1 px-3 py-3" : "gap-2 px-4 py-6"} ${over ? "border-brand bg-brand-soft" : "border-border bg-surface hover:border-brand/60 hover:bg-surface-2"} ${busy ? "pointer-events-none opacity-60" : ""}`}
    >
      <input ref={input} type="file" accept={ACCEPT} multiple={multiple} hidden
        onChange={(e) => { handle(e.target.files); e.target.value = ""; }} />
      <span className={`grid place-items-center rounded-full bg-brand-soft text-brand-text ${compact ? "h-7 w-7" : "h-10 w-10"}`}>
        <Icon name="upload" className={compact ? "h-3.5 w-3.5" : "h-5 w-5"} />
      </span>
      <p className="text-sm font-medium">{busy ? "Processing…" : label}</p>
      {!compact && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
      {options.map(([id, label, icon]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onChange(id)}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${value === id ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text"}`}>
          <Icon name={icon} className="h-3.5 w-3.5" />{label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ step, title, done, count }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${done ? "bg-ok text-white" : "bg-surface-2 text-muted"}`}>
        {done ? <Icon name="check" className="h-3 w-3" strokeWidth="3" /> : step}
      </span>
      <h2 className="text-sm font-semibold">{title}</h2>
      {count > 0 && <Badge tone="brand" className="ml-auto">{count}</Badge>}
    </div>
  );
}

function useTask(onChanged) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  return { busy, error, setError, run };
}

function ResumeSection({ docs, onChanged }) {
  const { busy, error, setError, run } = useTask(onChanged);
  const upload = (files) => run(async () => { for (const f of files) await uploadDocument(f, "resume"); });
  return (
    <section>
      <SectionTitle step="1" title="Your resume" done={docs.length > 0} />
      <ul className="space-y-2">
        {docs.map((d) => <DocItem key={d.id} doc={d} icon="file" onRemove={() => run(() => deleteDocument(d.id))} />)}
      </ul>
      <div className={docs.length ? "mt-2" : ""}>
        <DropZone onFiles={upload} busy={busy} compact={docs.length > 0}
          label={docs.length ? "Replace or add another" : "Drop your resume here or browse"}
          hint="PDF, DOCX, TXT or MD · up to 5 MB" />
      </div>
      {docs.length > 1 && <p className="mt-1.5 text-xs text-muted">The most recent resume is used for analysis.</p>}
      {error && <Alert className="mt-2" onDismiss={() => setError("")}>{error}</Alert>}
    </section>
  );
}

function JobsSection({ docs, onChanged }) {
  const { busy, error, setError, run } = useTask(onChanged);
  const [mode, setMode] = useState("file");
  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const failedOnLink = error && mode === "link";

  const upload = (files) => run(async () => { for (const f of files) await uploadDocument(f, "job"); });

  async function submitUrl(e) {
    e.preventDefault();
    if (!url.trim()) return;
    if (await run(() => importFromUrl(url.trim(), "job"))) setUrl("");
  }

  async function submitPaste() {
    if (!pasted.trim()) return;
    const file = new File([pasted], "pasted-job-description.txt", { type: "text/plain" });
    if (await run(() => uploadDocument(file, "job"))) setPasted("");
  }

  return (
    <section>
      <SectionTitle step="2" title="Job postings" done={docs.length > 0} count={docs.length} />
      <ul className="space-y-2">
        {docs.map((d) => <DocItem key={d.id} doc={d} icon="briefcase" onRemove={() => run(() => deleteDocument(d.id))} />)}
      </ul>

      <div className={`space-y-3 rounded-2xl border border-border bg-surface-2/50 p-3 ${docs.length ? "mt-2" : ""}`}>
        <Segmented value={mode} onChange={(m) => { setMode(m); setError(""); }}
          options={[["file", "File", "upload"], ["link", "Link", "link"], ["paste", "Paste", "paste"]]} />

        {mode === "file" && (
          <DropZone onFiles={upload} busy={busy} multiple compact={docs.length > 0}
            label="Drop job descriptions or browse" hint="PDF, DOCX, TXT or MD · add as many as you like" />
        )}

        {mode === "link" && (
          <form onSubmit={submitUrl} className="space-y-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" inputMode="url" autoComplete="off"
              placeholder="https://company.com/careers/senior-engineer" aria-label="Job posting link"
              className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/20" />
            <Button variant="primary" className="w-full" loading={busy} disabled={!url.trim()} icon="link">
              {busy ? "Importing…" : "Import job"}
            </Button>
            <p className="text-xs leading-relaxed text-muted">
              Works with public company career pages. LinkedIn, Indeed and Glassdoor block automated access, so for those, copy the description and use <b>Paste</b>.
            </p>
          </form>
        )}

        {mode === "paste" && (
          <div className="space-y-2">
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6} aria-label="Job description text"
              placeholder="Paste the full job description here…"
              className="w-full resize-y rounded-xl border border-border bg-surface p-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/20" />
            <Button variant="primary" className="w-full" loading={busy} disabled={!pasted.trim()} icon="check" onClick={submitPaste} type="button">
              Add job
            </Button>
          </div>
        )}

        {error && (
          <Alert onDismiss={() => setError("")}
            action={failedOnLink && (
              <Button size="sm" variant="secondary" icon="paste" onClick={() => { setMode("paste"); setError(""); }}>
                Paste the description instead
              </Button>
            )}>
            {error}
          </Alert>
        )}
      </div>
    </section>
  );
}

export default function UploadPanel({ docs, onChanged }) {
  return (
    <div className="space-y-6">
      <ResumeSection docs={docs.filter((d) => d.doc_type === "resume")} onChanged={onChanged} />
      <JobsSection docs={docs.filter((d) => d.doc_type === "job")} onChanged={onChanged} />
    </div>
  );
}
