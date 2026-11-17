import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Turn "[1]" markers into links the renderer below shows as clickable chips. */
const withCitationLinks = (text) => text.replace(/\[(\d+)\]/g, "[$1](#cite-$1)");

export default function Markdown({ text, sources = [], onCite }) {
  const components = {
    a: ({ href, children }) => {
      const m = href?.match(/^#cite-(\d+)$/);
      if (!m) return <a href={href} target="_blank" rel="noreferrer" className="text-indigo-600 underline">{children}</a>;
      const src = sources.find((s) => s.id === Number(m[1]));
      return src ? (
        <button type="button" onClick={() => onCite?.(src)} title={`${src.document} · ${src.section}`}
          className="mx-0.5 rounded bg-indigo-100 px-1.5 align-baseline text-xs font-medium text-indigo-700 hover:bg-indigo-200">
          {m[1]}
        </button>
      ) : (
        <span className="text-slate-400">[{m[1]}]</span>
      );
    },
    p: (p) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...p} />,
    strong: (p) => <strong className="font-semibold text-slate-900" {...p} />,
    ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
    ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
    h1: (p) => <h3 className="mb-1 mt-3 text-base font-semibold" {...p} />,
    h2: (p) => <h3 className="mb-1 mt-3 text-base font-semibold" {...p} />,
    h3: (p) => <h4 className="mb-1 mt-3 font-semibold" {...p} />,
    code: (p) => <code className="rounded bg-slate-100 px-1 py-0.5 text-xs" {...p} />,
    // Tables: scrollable wrapper, light grid, zebra rows, so wide tables stay readable.
    table: (p) => (
      <div className="my-3 overflow-x-auto rounded-lg ring-1 ring-slate-200">
        <table className="w-full border-collapse text-left text-sm" {...p} />
      </div>
    ),
    thead: (p) => <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600" {...p} />,
    th: (p) => <th className="px-3 py-2 font-semibold" {...p} />,
    td: (p) => <td className="border-t border-slate-100 px-3 py-2 align-top" {...p} />,
    tr: (p) => <tr className="even:bg-slate-50/60" {...p} />,
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {withCitationLinks(text)}
    </ReactMarkdown>
  );
}
