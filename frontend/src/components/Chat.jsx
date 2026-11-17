import { useEffect, useRef, useState } from "react";
import { streamChat } from "../api.js";
import Markdown from "./Markdown.jsx";
import { Alert, Badge, Button, Icon } from "./ui.jsx";

const SUGGESTIONS = [
  { icon: "target", title: "Skill gaps", text: "What skills am I missing for these roles?" },
  { icon: "chart", title: "Best match", text: "Which job fits my experience best, and why?" },
  { icon: "users", title: "Interview prep", text: "What interview questions should I prepare for?" },
  { icon: "lightbulb", title: "Stand out", text: "What should I highlight on my resume to stand out for these roles?" },
];

function Avatar() {
  return (
    <span className="brand-gradient mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-white">
      <Icon name="sparkles" className="h-4 w-4" />
    </span>
  );
}

function Typing() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Assistant is thinking">
      {[0, 1, 2].map((i) => (
        <span key={i} className="typing-dot h-2 w-2 rounded-full bg-muted" style={{ animationDelay: `${i * 0.18}s` }} />
      ))}
    </div>
  );
}

function Welcome({ hasDocs, resumes, jobs, onPick }) {
  if (!hasDocs) {
    const steps = [
      [resumes > 0, "Upload your resume", "PDF, DOCX or text"],
      [jobs > 0, "Add one or more job postings", "File, link or pasted text"],
      [false, "Ask questions, see your fit, prepare for interviews", "Unlocks once both are added"],
    ];
    return (
      <div className="animate-fade-up mx-auto mt-10 max-w-md text-center sm:mt-16">
        <span className="brand-gradient shadow-brand mx-auto grid h-14 w-14 place-items-center rounded-2xl text-white">
          <Icon name="sparkles" className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight">Let's get you <span className="brand-text">interview-ready</span></h2>
        <p className="mt-2 text-sm text-muted">Three quick steps and you can compare your resume with any role.</p>
        <ol className="mt-6 space-y-2 text-left">
          {steps.map(([done, title, sub], i) => (
            <li key={title} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${done ? "border-ok/30 bg-ok-soft" : "border-border bg-surface"}`}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? "bg-ok text-white" : "bg-surface-2 text-muted"}`}>
                {done ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth="3" /> : i + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted">{sub}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <div className="animate-fade-up mx-auto mt-8 max-w-2xl text-center sm:mt-14">
      <span className="brand-gradient shadow-brand mx-auto grid h-14 w-14 place-items-center rounded-2xl text-white">
        <Icon name="sparkles" className="h-7 w-7" />
      </span>
      <h2 className="mt-5 text-2xl font-semibold tracking-tight">What would you like to <span className="brand-text">know?</span></h2>
      <p className="mt-2 text-sm text-muted">Answers come only from your documents, with citations you can click.</p>
      <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button key={s.title} onClick={() => onPick(s.text)}
            className="shadow-soft group flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:-translate-y-0.5 hover:border-brand/50">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-text transition group-hover:brand-gradient group-hover:text-white">
              <Icon name={s.icon} className="h-4 w-4" />
            </span>
            <span className="text-left">
              <span className="block text-sm font-semibold">{s.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">{s.text}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SourcePanel({ source, onClose }) {
  const pct = Math.round(source.score * 100);
  return (
    <aside className="animate-fade-up shadow-soft mx-auto mb-3 w-full max-w-3xl rounded-2xl border border-brand/30 bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="brand">[{source.id}]</Badge>
        <span className="min-w-0 truncate font-medium">{source.document}</span>
        <Badge>{source.section}</Badge>
        <span className="ml-auto flex items-center gap-2 text-muted">
          match {pct}%
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
            <span className="brand-gradient block h-full rounded-full" style={{ width: `${pct}%` }} />
          </span>
        </span>
        <button onClick={onClose} aria-label="Close source" className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      <p className="max-h-40 overflow-y-auto whitespace-pre-wrap border-l-2 border-brand/40 pl-3 text-sm leading-relaxed text-muted">{source.text}</p>
    </aside>
  );
}

function Message({ m, onCite }) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user") {
    return (
      <div className="animate-fade-up flex justify-end">
        <div className="brand-gradient max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-4 py-2.5 text-sm text-white shadow-sm">{m.text}</div>
      </div>
    );
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }
  return (
    <div className="animate-fade-up group flex gap-3">
      <Avatar />
      <div className="min-w-0 max-w-[calc(100%-2.75rem)] flex-1">
        <div className="shadow-soft rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3 text-sm">
          {m.text ? <Markdown text={m.text} sources={m.sources} onCite={onCite} /> : !m.error && <Typing />}
          {m.stopped && <p className="mt-2 text-xs italic text-muted">Stopped.</p>}
          {m.error && <Alert className="mt-1">{m.error}</Alert>}
        </div>
        {m.text && !m.streaming && (
          <div className="mt-1 flex items-center gap-1 pl-1 text-xs text-muted opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
            <button onClick={copy} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-2 hover:text-text">
              <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy"}
            </button>
            {m.sources?.length > 0 && <span className="px-2">{m.sources.length} source{m.sources.length > 1 ? "s" : ""} used</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Chat({ hasDocs, resumes, jobs }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cited, setCited] = useState(null);
  const bottom = useRef(null);
  const field = useRef(null);
  const abort = useRef(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Grow the textarea with its content (up to ~6 lines). Browsers that support
  // `field-sizing: content` (Chrome, Edge, Safari) do this natively via CSS; others use this fallback.
  useEffect(() => {
    const el = field.current;
    if (!el || CSS.supports("field-sizing", "content")) return;
    const frame = requestAnimationFrame(() => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    });
    return () => cancelAnimationFrame(frame);
  }, [input, hasDocs]);

  const patchLast = (fn) => setMessages((m) => m.map((x, i) => (i === m.length - 1 ? fn(x) : x)));

  async function send(question) {
    const text = question.trim();
    if (!text || busy || !hasDocs) return;
    setInput("");
    setCited(null);
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "", sources: [], streaming: true }]);
    abort.current = new AbortController();
    try {
      await streamChat(text, null, (e) => {
        if (e.type === "sources") patchLast((x) => ({ ...x, sources: e.sources }));
        else if (e.type === "token") patchLast((x) => ({ ...x, text: x.text + e.text }));
        else if (e.type === "error") patchLast((x) => ({ ...x, error: e.message }));
      }, abort.current.signal);
    } catch (err) {
      if (err.name === "AbortError") patchLast((x) => ({ ...x, stopped: true }));
      else patchLast((x) => ({ ...x, error: err.message }));
    } finally {
      patchLast((x) => ({ ...x, streaming: false }));
      setBusy(false);
      abort.current = null;
    }
  }

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-5">
          {messages.length === 0 && <Welcome hasDocs={hasDocs} resumes={resumes} jobs={jobs} onPick={send} />}
          {messages.map((m, i) => <Message key={i} m={m} onCite={setCited} />)}
          <div ref={bottom} />
        </div>
      </div>

      <div className="glass border-t border-border px-4 pb-4 pt-3">
        {cited && <SourcePanel source={cited} onClose={() => setCited(null)} />}
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mx-auto w-full max-w-3xl">
          <div className="shadow-soft flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
            <textarea ref={field} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
              rows={1} disabled={!hasDocs} aria-label="Ask a question"
              placeholder={hasDocs ? "Ask about fit, gaps or interview prep…" : "Add a resume and a job to start"}
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none [field-sizing:content] placeholder:text-muted/70 disabled:cursor-not-allowed" />
            {busy ? (
              <Button type="button" variant="secondary" size="icon" icon="stop" onClick={() => abort.current?.abort()} aria-label="Stop generating" />
            ) : (
              <Button type="submit" variant="primary" size="icon" icon="send" disabled={!hasDocs || !input.trim()} aria-label="Send" />
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-muted">
            <span>Enter to send · Shift+Enter for a new line</span>
            {messages.length > 0 && (
              <button type="button" onClick={() => { if (!busy) { setMessages([]); setCited(null); } }} disabled={busy}
                className="flex items-center gap-1 hover:text-text disabled:opacity-50">
                <Icon name="refresh" className="h-3 w-3" />New chat
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
