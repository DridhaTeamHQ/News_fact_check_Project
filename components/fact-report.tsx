"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import type { ClaimVerdict, FactCheckReport, FactLabel } from "@/lib/factcheck";
import { cn } from "@/lib/utils";

/* ---------- visual vocab (Shortly's labels and bands) ---------- */

const LABEL_THEME: Record<FactLabel | "unscored", { word: string; text: string; badge: string }> = {
  verified: {
    word: "Verified",
    text: "text-emerald-700 dark:text-emerald-400",
    badge: "border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-200",
  },
  "mostly-factual": {
    word: "Mostly factual",
    text: "text-teal-700 dark:text-teal-400",
    badge: "border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-500 dark:bg-teal-950/50 dark:text-teal-200",
  },
  mixed: {
    word: "Mixed",
    text: "text-amber-700 dark:text-amber-400",
    badge: "border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-500 dark:bg-amber-950/50 dark:text-amber-200",
  },
  unverified: {
    word: "Unverified",
    text: "text-red-700 dark:text-red-400",
    badge: "border-red-600 bg-red-50 text-red-800 dark:border-red-500 dark:bg-red-950/50 dark:text-red-200",
  },
  unscored: {
    word: "Not checked",
    text: "text-zinc-600 dark:text-zinc-400",
    badge: "border-zinc-400 bg-zinc-100 text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
  },
};

const CLAIM_STYLE: Record<ClaimVerdict, { label: string; cls: string }> = {
  supported: { label: "Supported", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200" },
  "partially-supported": { label: "Partly supported", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200" },
  unsupported: { label: "Not in source", cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  contradicted: { label: "Contradicted", cls: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200" },
};

const SIGNALS: { key: "attribution" | "specificity" | "tone"; label: string }[] = [
  { key: "attribution", label: "Attribution" },
  { key: "specificity", label: "Specificity" },
  { key: "tone", label: "Tone" },
];

const STEPS = ["Reading the original article…", "Finding other outlets in Shortly's feeds…", "Checking every claim…"];

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/* ---------- running a check ---------- */

export type CheckPayload = { pixId?: string; url?: string; force?: boolean };

/** Calls /api/check and tracks loading / progress step / error / report. */
export function useFactCheck() {
  const [report, setReport] = useState<(FactCheckReport & { cached?: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const inFlight = useRef(false);

  const run = useCallback(async (payload: CheckPayload) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    setReport(null);
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4_000);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setReport(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      clearInterval(timer);
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  return { report, error, loading, step, run };
}

export function FactCheckProgress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-5" aria-live="polite">
      <Loader2 className="size-5 animate-spin text-primary" />
      <div>
        <div className="font-medium">{STEPS[step]}</div>
        <div className="text-sm text-muted-foreground">Usually takes 5–20 seconds.</div>
      </div>
    </div>
  );
}

export function FactCheckError({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
      role="alert"
    >
      {message}
    </div>
  );
}

/* ---------- result ---------- */

export function FactReport({ report }: { report: FactCheckReport }) {
  const [open, setOpen] = useState(false);
  const theme = LABEL_THEME[report.label ?? "unscored"];
  const n = report.sources.length;
  // Shortly shows a badge only from 65 up; below that, show what sources say.
  const weak = report.scored && (report.score ?? 0) < 65;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-muted/40 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "flex size-14 shrink-0 items-center justify-center rounded-full border-2 text-xl font-semibold tabular-nums",
              theme.badge,
            )}
            aria-label={report.scored ? `Fact score ${report.score} out of 100` : "Not scored"}
          >
            {report.scored ? report.score : "–"}
          </div>
          <div className="min-w-0">
            <div className={cn("text-sm font-bold tracking-wide uppercase", theme.text)}>{theme.word} · AI fact check</div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {n > 0
                ? `Claims checked across ${n} independent source${n === 1 ? "" : "s"} · ${fmtDate(report.checked_at)}.`
                : `No source to check against · ${fmtDate(report.checked_at)}.`}
            </div>
          </div>
        </div>

        {report.rationale && <p className="mt-4 text-[15px] leading-relaxed">{report.rationale}</p>}
        {report.note && <p className={cn("text-sm text-muted-foreground", report.rationale ? "mt-2" : "mt-4")}>{report.note}</p>}

        {report.scored && report.claims.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="mt-4 inline-flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm font-semibold shadow-xs transition-colors hover:bg-muted"
            >
              Claim-by-claim breakdown ({report.claims.length})
              <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
            </button>
            {open && (
              <div className="mt-4 space-y-3">
                <ul className="space-y-2">
                  {report.claims.map((c, i) => {
                    const v = CLAIM_STYLE[c.verdict];
                    return (
                      <li key={i} className="flex items-start gap-3 rounded-lg border bg-background p-3">
                        <span className={cn("mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", v.cls)}>{v.label}</span>
                        <span className="text-sm">{c.claim}</span>
                      </li>
                    );
                  })}
                </ul>
                {report.signals && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {SIGNALS.map((s) => (
                      <span key={s.key} className="rounded-full border bg-background px-3 py-1 text-muted-foreground">
                        {s.label}: <span className="font-semibold text-foreground tabular-nums">{report.signals![s.key]}/2</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {n > 0 && (
          <div className="mt-5 border-t pt-4">
            <div className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
              Checked across {n} source{n === 1 ? "" : "s"}
            </div>
            <ol className="mt-3 space-y-2.5">
              {report.sources.map((s, i) => (
                <li key={s.url} className="flex items-start gap-3 text-[15px]">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={s.title}
                      className="underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground"
                    >
                      {s.source}
                    </a>
                    {s.primary && <span className="ml-2 text-xs text-muted-foreground">original source</span>}
                    {s.match === "related" && (
                      <span
                        className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                        title="Covers one of the news events in this story, not the whole story"
                      >
                        related
                      </span>
                    )}
                    {(s.title || s.published) && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={s.title}>
                        {[s.title, s.published ? fmtDay(s.published) : ""].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {/* Actual news: what each source reports, when our story scores low. */}
      {weak && n > 0 && (
        <section className="rounded-xl border bg-card p-5 sm:p-6">
          <div className="text-xs font-bold tracking-wider text-muted-foreground uppercase">What the sources report</div>
          <ul className="mt-3 space-y-4">
            {report.sources
              .filter((s) => s.title || s.excerpt)
              .map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-start gap-1 font-semibold hover:underline"
                  >
                    {s.title || s.source} <ExternalLink className="mt-1 size-3.5 shrink-0" />
                  </a>
                  <div className="text-xs text-muted-foreground">{s.source}</div>
                  {s.excerpt && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.excerpt}…</p>}
                </li>
              ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Shortly fact-check method ({report.method}, {report.model}): our story is checked claim by claim against the original
        article and other outlets from Shortly&apos;s feeds. Score = 70% claim grounding + 30% source credibility; any
        contradicted claim caps it at 45.
      </p>
    </div>
  );
}
