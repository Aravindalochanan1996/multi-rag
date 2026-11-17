import { useCallback, useEffect, useState } from "react";
import { clearWorkspace, listDocuments } from "./api.js";
import UploadPanel from "./components/UploadPanel.jsx";
import Chat from "./components/Chat.jsx";
import FitView from "./components/FitView.jsx";
import InterviewView from "./components/InterviewView.jsx";
import ResumeTipsView from "./components/ResumeTipsView.jsx";
import { Alert, Button, Icon } from "./components/ui.jsx";

const TABS = [
  ["chat", "Ask", "chat"],
  ["fit", "Fit & gaps", "chart"],
  ["interview", "Interview prep", "users"],
  ["tips", "Resume tips", "lightbulb"],
];

/** Theme: follows the OS until the user picks one with the toggle. Only this preference is
 *  stored in the browser; documents never are. */
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("theme"); } catch { return null; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme; else delete root.dataset.theme;
    try { theme ? localStorage.setItem("theme", theme) : localStorage.removeItem("theme"); } catch { /* private mode */ }
  }, [theme]);
  const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return [dark, () => setTheme(dark ? "light" : "dark")];
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="brand-gradient shadow-brand grid h-10 w-10 place-items-center rounded-xl text-white">
        <Icon name="sparkles" className="h-5 w-5" />
      </span>
      <div className="leading-tight">
        <h1 className="text-base font-semibold tracking-tight">Career Intelligence</h1>
        <p className="text-xs text-muted">Resume × job postings</p>
      </div>
    </div>
  );
}

export default function App() {
  const [docs, setDocs] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("chat");
  const [drawer, setDrawer] = useState(false);
  const [dark, toggleTheme] = useTheme();

  const refresh = useCallback(async () => {
    try {
      setDocs(await listDocuments());
      setError("");
    } catch (e) {
      setError(`Can't reach the server: ${e.message}`);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const resumes = docs.filter((d) => d.doc_type === "resume").length;
  const jobs = docs.filter((d) => d.doc_type === "job").length;
  const ready = resumes > 0 && jobs > 0;

  async function clearAll() {
    if (!docs.length || !window.confirm("Remove your resume and all job postings from this workspace?")) return;
    try { await clearWorkspace(); } finally { await refresh(); }
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Mobile backdrop */}
      {drawer && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setDrawer(false)} aria-hidden="true" />}

      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[22rem] max-w-[92vw] flex-col border-r border-border bg-surface transition-transform duration-200 md:static md:translate-x-0 ${drawer ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <Brand />
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setDrawer(false)} aria-label="Close menu" icon="x" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-2">
          {error && <Alert className="mb-4">{error}</Alert>}
          <UploadPanel docs={docs} onChanged={refresh} />
        </div>
        <div className="space-y-2 border-t border-border px-5 py-4">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <Icon name="shield" className="mt-0.5 h-4 w-4 text-ok" />
            Your documents stay in this session only. Refreshing the page removes them.
          </p>
          {docs.length > 0 && (
            <Button variant="danger" size="sm" icon="trash" onClick={clearAll} className="w-full">Clear workspace</Button>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass z-20 flex items-center gap-3 border-b border-border px-4 py-3">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setDrawer(true)} aria-label="Open menu" icon="menu" />
          <nav className="flex gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Sections">
            {TABS.map(([id, label, icon]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === id ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text"}`}>
                <Icon name={icon} className="h-4 w-4" />
                <span className="hidden lg:inline">{label}</span>
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className={`hidden items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium xl:inline-flex ${ready ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-ok" : "bg-warn"}`} />
              {ready ? `Ready · ${jobs} job${jobs > 1 ? "s" : ""}` : "Add a resume and a job"}
            </span>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} icon={dark ? "sun" : "moon"} />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">
          <div className={tab === "chat" ? "h-full" : "hidden"}><Chat hasDocs={ready} resumes={resumes} jobs={jobs} /></div>
          <div className={tab === "fit" ? "h-full overflow-y-auto" : "hidden"}><FitView docs={docs} /></div>
          <div className={tab === "interview" ? "h-full overflow-y-auto" : "hidden"}><InterviewView docs={docs} /></div>
          <div className={tab === "tips" ? "h-full overflow-y-auto" : "hidden"}><ResumeTipsView docs={docs} /></div>
        </main>
      </div>
    </div>
  );
}
