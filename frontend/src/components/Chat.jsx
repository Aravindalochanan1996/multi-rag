import { useEffect, useRef, useState } from "react";
import { streamChat } from "../api.js";
import Markdown from "./Markdown.jsx";

const SUGGESTIONS = [
  "What skills am I missing for this role?",
  "How does my experience align with the job?",
  "What interview questions should I prepare?",
];

/** Renders the answer as formatted markdown (tables, bold, lists) with clickable citation chips. */
function Answer({ text, sources, onCite }) {
  return <Markdown text={text} sources={sources} onCite={onCite} />;
}

export default function Chat({ hasDocs }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cited, setCited] = useState(null);
  const bottom = useRef(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function patchLast(fn) {
    setMessages((m) => m.map((x, i) => (i === m.length - 1 ? fn(x) : x)));
  }

  async function send(question) {
    if (!question.trim() || busy) return;
    setInput("");
    setCited(null);
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: question }, { role: "assistant", text: "", sources: [] }]);
    try {
      await streamChat(question, null, (e) => {
        if (e.type === "sources") patchLast((x) => ({ ...x, sources: e.sources }));
        else if (e.type === "token") patchLast((x) => ({ ...x, text: x.text + e.text }));
        else if (e.type === "error") patchLast((x) => ({ ...x, error: e.message }));
      });
    } catch (err) {
      patchLast((x) => ({ ...x, error: err.message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        {messages.length === 0 && (
          <div className="mx-auto mt-16 max-w-md space-y-3 text-center">
            <p className="text-slate-500">
              {hasDocs ? "Ask anything about your fit for the roles you added." : "Upload your resume and at least one job posting to begin."}
            </p>
            {hasDocs && SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)}
                className="block w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm hover:border-indigo-400">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex"}>
            <div className={`min-w-0 rounded-2xl px-4 py-3 text-sm ${m.role === "user" ? "max-w-[80%] bg-indigo-600 text-white" : "max-w-[92%] bg-white shadow-sm ring-1 ring-slate-200"}`}>
              {m.role === "user" ? m.text : (
                <>
                  {m.text ? <Answer text={m.text} sources={m.sources} onCite={setCited} /> : !m.error && <span className="text-slate-400">Thinking…</span>}
                  {m.error && <p role="alert" className="text-red-600">{m.error}</p>}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {cited && (
        <aside className="mx-6 mb-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">
          <div className="mb-1 flex items-center justify-between text-xs text-indigo-700">
            <span>[{cited.id}] {cited.document} · {cited.section} · match {Math.round(cited.score * 100)}%</span>
            <button onClick={() => setCited(null)} aria-label="Close source">✕</button>
          </div>
          <p className="whitespace-pre-wrap text-slate-700">{cited.text}</p>
        </aside>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-slate-200 bg-white p-4">
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={!hasDocs}
          placeholder={hasDocs ? "Ask about fit, gaps, interview prep…" : "Upload documents first"}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100" />
        <button disabled={busy || !hasDocs || !input.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
