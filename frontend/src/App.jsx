import { useCallback, useEffect, useState } from "react";
import { listDocuments } from "./api.js";
import UploadPanel from "./components/UploadPanel.jsx";
import Chat from "./components/Chat.jsx";
import FitView from "./components/FitView.jsx";
import InterviewView from "./components/InterviewView.jsx";

const TABS = [["chat", "Ask questions"], ["fit", "Fit & gaps"], ["interview", "Interview prep"]];

export default function App() {
  const [docs, setDocs] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("chat");

  const refresh = useCallback(async () => {
    try {
      setDocs(await listDocuments());
      setError("");
    } catch (e) {
      setError(`API unreachable: ${e.message}`);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const hasDocs = docs.some((d) => d.doc_type === "resume") && docs.some((d) => d.doc_type === "job");

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <aside className="w-80 shrink-0 space-y-6 overflow-y-auto border-r border-slate-200 p-5">
        <header>
          <h1 className="text-lg font-semibold">Career Intelligence</h1>
          <p className="text-xs text-slate-500">Resume vs. job postings, grounded in your documents.</p>
        </header>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <UploadPanel docs={docs} onChanged={refresh} />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <nav className="flex gap-1 border-b border-slate-200 bg-white px-4 pt-3">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`rounded-t-md px-4 py-2 text-sm font-medium ${tab === id ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-800"}`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className={tab === "chat" ? "h-full" : "hidden"}><Chat hasDocs={hasDocs} /></div>
          <div className={tab === "fit" ? "h-full overflow-y-auto" : "hidden"}><FitView docs={docs} /></div>
          <div className={tab === "interview" ? "h-full overflow-y-auto" : "hidden"}><InterviewView docs={docs} /></div>
        </div>
      </main>
    </div>
  );
}
