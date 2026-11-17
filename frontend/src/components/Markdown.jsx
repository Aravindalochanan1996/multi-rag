import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Turn "[1]" markers into links the renderer below shows as clickable citation chips. */
const withCitationLinks = (text) => text.replace(/\[(\d+)\]/g, "[$1](#cite-$1)");

export default function Markdown({ text, sources = [], onCite }) {
  const components = {
    a: ({ href, children }) => {
      const m = href?.match(/^#cite-(\d+)$/);
      if (!m) return <a href={href} target="_blank" rel="noreferrer" className="text-brand-text underline underline-offset-2">{children}</a>;
      const src = sources.find((s) => s.id === Number(m[1]));
      return src ? (
        <button type="button" onClick={() => onCite?.(src)} title={`${src.document} · ${src.section}`}
          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-brand-soft px-1 align-baseline text-[11px] font-semibold text-brand-text transition hover:brand-gradient hover:text-white">
          {m[1]}
        </button>
      ) : (
        <span className="text-muted">[{m[1]}]</span>
      );
    },
    p: (p) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...p} />,
    strong: (p) => <strong className="font-semibold" {...p} />,
    ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-brand" {...p} />,
    ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:font-medium marker:text-brand" {...p} />,
    h1: (p) => <h3 className="mb-1 mt-4 text-base font-semibold" {...p} />,
    h2: (p) => <h3 className="mb-1 mt-4 text-base font-semibold" {...p} />,
    h3: (p) => <h4 className="mb-1 mt-3 font-semibold" {...p} />,
    hr: () => <hr className="my-3 border-border" />,
    blockquote: (p) => <blockquote className="my-2 border-l-2 border-brand/50 pl-3 text-muted" {...p} />,
    code: (p) => <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.85em]" {...p} />,
    // Tables: scrollable wrapper, soft grid, zebra rows, so wide tables stay readable.
    table: (p) => (
      <div className="my-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-left text-sm" {...p} />
      </div>
    ),
    thead: (p) => <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted" {...p} />,
    th: (p) => <th className="px-3 py-2 font-semibold" {...p} />,
    td: (p) => <td className="border-t border-border px-3 py-2 align-top" {...p} />,
    tr: (p) => <tr className="even:bg-surface-2/40" {...p} />,
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {withCitationLinks(text)}
    </ReactMarkdown>
  );
}
