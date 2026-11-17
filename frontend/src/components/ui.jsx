/* Small shared UI kit: icons, buttons, alerts, score ring, skeletons. */
import { useEffect, useRef } from "react";

const PATHS = {
  upload: "M12 16V4m0 0L8 8m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6",
  briefcase: "M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  paste: "M9 4h6a1 1 0 0 1 1 1v2H8V5a1 1 0 0 1 1-1zM8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2M9 12h6M9 16h4",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z",
  chart: "M4 20h16M7 16V9m5 7V5m5 11v-4",
  chat: "M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z",
  users: "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  check: "M5 13l4 4L19 7",
  x: "M6 6l12 12M18 6 6 18",
  copy: "M9 9h10v10H9zM5 15V5h10",
  menu: "M4 6h16M4 12h16M4 18h16",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  alert: "M12 9v4m0 4h.01M10.3 3.9 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  trash: "M5 7h14M10 11v6m4-6v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4",
  stop: "M7 7h10v10H7z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  chevron: "M6 9l6 6 6-6",
  lightbulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  question: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 18h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
};

export function Icon({ name, className = "h-5 w-5", ...props }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden="true" {...props}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Spinner({ className = "h-4 w-4" }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const VARIANTS = {
  primary: "brand-gradient text-white shadow-brand hover:brightness-110 active:brightness-95",
  secondary: "border border-border bg-surface text-text hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  soft: "bg-brand-soft text-brand-text hover:brightness-95",
  danger: "text-bad hover:bg-bad-soft",
};
const SIZES = { sm: "h-8 gap-1.5 px-3 text-xs", md: "h-10 gap-2 px-4 text-sm", icon: "h-9 w-9 justify-center" };

export function Button({ variant = "secondary", size = "md", icon, loading = false, className = "", children, ...props }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center rounded-xl font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

const TONES = {
  danger: "border-bad/30 bg-bad-soft text-bad",
  warn: "border-warn/30 bg-warn-soft text-warn",
  info: "border-brand/25 bg-brand-soft text-brand-text",
  ok: "border-ok/30 bg-ok-soft text-ok",
};

export function Alert({ tone = "danger", children, action, onDismiss, className = "" }) {
  const ref = useRef(null);
  // Make sure a new error is actually seen, even inside a short scrolling sidebar.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  return (
    <div ref={ref} role="alert" className={`animate-fade-up flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${TONES[tone]} ${className}`}>
      <Icon name="alert" className="mt-0.5 h-4 w-4" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="leading-snug">{children}</p>
        {action}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded p-0.5 opacity-70 hover:opacity-100">
          <Icon name="x" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Badge({ tone = "neutral", children, className = "" }) {
  const t = {
    neutral: "bg-surface-2 text-muted",
    brand: "bg-brand-soft text-brand-text",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${t} ${className}`}>{children}</span>;
}

export const scoreTone = (s) => (s >= 70 ? "ok" : s >= 40 ? "warn" : "bad");

/** Circular fit score. The arc animates in on mount. */
export function ScoreRing({ score, size = 84, stroke = 9 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const to = c * (1 - score / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Fit score ${score} percent`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`var(--${scoreTone(score)})`} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={to} className="ring-arc"
          style={{ "--c": c, "--to": to }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-xl font-semibold tabular-nums leading-none">{score}<span className="text-xs font-medium text-muted">%</span></span>
      </div>
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`shimmer rounded-lg ${className}`} />;
}

/** A thin bar that slides while we wait on a model with no measurable total. */
export function IndeterminateBar() {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="indeterminate brand-gradient h-full w-1/3 rounded-full" />
    </div>
  );
}

export function Card({ className = "", children, ...props }) {
  return <div {...props} className={`shadow-soft rounded-2xl border border-border bg-surface ${className}`}>{children}</div>;
}
