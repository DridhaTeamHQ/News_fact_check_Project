"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FactCheckError, FactReport, fmtDate } from "@/components/fact-report";
import { PixImage } from "@/components/pix-image";
import { VERDICT_THEME } from "@/components/verdict";
import type { TextCheckResult, TextLink } from "@/lib/text-check";
import type { VerdictLabel } from "@/lib/verdict";
import { cn } from "@/lib/utils";

const STEPS = [
  "Reading the message…",
  "Searching DailyMattr PIX…",
  "Finding other outlets and fact-checkers…",
  "Checking every claim…",
  "Searching the news for unconfirmed claims…",
  "Writing up the real news…",
];

const EXAMPLE =
  "🚨🚨 BIG BREAKING 🚨🚨 PM Modi to announce DEMONETISATION of ₹500 notes from midnight tomorrow!! All ₹500 notes will become INVALID. Exchange them at your nearest bank before Friday or LOSE your money ❌❌ RBI circular already issued. Share with all family groups 🙏🙏 Forward to 10 groups";

const KIND_LABEL: Record<TextLink["kind"], string> = {
  dailymattr: "DailyMattr PIX",
  "fact-check": "Fact-check",
  outlet: "News report",
};

/** The reply's opening, by verdict: the answer first, in plain words. */
const OPENING: Record<VerdictLabel, { title: string; lead: React.ReactNode }> = {
  false: {
    title: "🎯 Hey, you’ve spotted fake news!",
    lead: (
      <>
        This message is <strong>not real</strong>.
      </>
    ),
  },
  "partly-false": {
    title: "⚠️ Careful: parts of this are fake",
    lead: (
      <>
        Some of what this message says is <strong>wrong</strong>.
      </>
    ),
  },
  unverified: {
    title: "🤔 We couldn’t confirm this",
    lead: (
      <>
        No trusted source reports this, so <strong>don’t trust it yet</strong>.
      </>
    ),
  },
  "mostly-true": {
    title: "✅ This news is mostly real",
    lead: (
      <>
        Most of it <strong>matches trusted reports</strong>.
      </>
    ),
  },
  true: {
    title: "✅ This news is real",
    lead: (
      <>
        Trusted sources <strong>report the same thing</strong>.
      </>
    ),
  },
};

const TRUE_ADVICE = "It’s safe to share. Read the full story from the sources below.";

/** "Check a message": paste any text, get True / False with sources, and the
 * real news when it's false. */
export function TextChecker() {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState("");
  const [result, setResult] = useState<TextCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const inFlight = useRef(false);
  const value = text.trim();

  async function run(force = false, message = value) {
    if (inFlight.current || !message) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    setResult(null);
    setChecked(message);
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 7_000);
    try {
      const res = await fetch("/api/check-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message, force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      clearInterval(timer);
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Is this news real?</h1>
      <p className="mt-2 text-muted-foreground">
        Paste a message, a forward or any news text. We check it against DailyMattr PIX, fact-checkers and other news
        outlets, and tell you whether it&apos;s true or false.
      </p>

      <form
        className="mt-6 rounded-xl border bg-card p-4 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <label htmlFor="message" className="text-sm font-medium">
          Message to check
        </label>
        <textarea
          id="message"
          rows={6}
          maxLength={5000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              run();
            }
          }}
          placeholder="Paste the message here…"
          className="mt-2 block w-full resize-y rounded-lg border bg-background px-3 py-2 text-[15px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setText(EXAMPLE)}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Try an example forward
          </button>
          <Button type="submit" disabled={loading || value.length < 15} className="h-10">
            {loading ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Check
          </Button>
        </div>
      </form>

      <div className="mt-8 space-y-5">
        {loading && (
          <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-5" aria-live="polite">
            <Loader2 className="size-5 animate-spin text-primary" />
            <div>
              <div className="font-medium">{STEPS[step]}</div>
              <div className="text-sm text-muted-foreground">Usually takes 30–70 seconds.</div>
            </div>
          </div>
        )}
        {error && <FactCheckError message={error} />}
        {result && <TextResult result={result} message={checked} onRecheck={() => run(true, checked)} />}
      </div>
    </div>
  );
}

function TextResult({ result, message, onRecheck }: { result: TextCheckResult; message: string; onRecheck: () => void }) {
  const [details, setDetails] = useState(false);
  const { report, realNews, links, pix, scores } = result;
  const verdict = report.verdict;
  const t = VERDICT_THEME[verdict.label];
  const Icon = t.icon;
  const opening = OPENING[verdict.label];
  const confirmed = verdict.label === "true" || verdict.label === "mostly-true";
  const advice = confirmed ? [TRUE_ADVICE] : (realNews?.advice ?? []);
  // "Read: …" buttons, one per source the real news cites.
  const reads = (realNews?.points ?? [])
    .filter((p): p is typeof p & { link: number } => p.link !== null && Boolean(links[p.link]))
    .filter((p, i, all) => all.findIndex((q) => q.link === p.link) === i);

  return (
    <>
      {/* The answer, first */}
      <section className={cn("overflow-hidden rounded-2xl border-2", t.banner)} aria-label={`Verdict: ${t.word}`}>
        <div className="flex items-center gap-3 px-5 pt-5 sm:px-6">
          <Icon className="size-10 shrink-0" aria-hidden />
          <div>
            <div className="text-xs font-bold tracking-wider uppercase opacity-80">Verdict</div>
            <div className="text-4xl leading-none font-extrabold tracking-tight uppercase">{t.word}</div>
          </div>
        </div>

        <div className="space-y-3 px-5 pt-4 pb-5 sm:px-6">
          {/* The message this answers, quoted like a chat reply */}
          <div className="rounded-lg border-l-4 border-current/40 bg-background/60 px-3 py-2 text-sm">
            <div className="text-xs font-semibold opacity-70">Your message</div>
            <p className="line-clamp-2 opacity-80">{message}</p>
          </div>

          <p className="text-xl font-bold leading-snug">{opening.title}</p>
          <p className="text-[15px] leading-relaxed">
            {opening.lead} {realNews?.headline}
          </p>
          <p className="text-sm leading-relaxed opacity-80">{verdict.reason}</p>

          {advice.length > 0 && (
            <ul className="space-y-1.5">
              {advice.map((a, i) => (
                <li key={i} className="flex gap-2 text-[15px] font-semibold leading-snug">
                  <span aria-hidden>✅</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Meter
              label="Fake"
              value={scores.fakePercent}
              max={100}
              unit="%"
              bar="bg-red-600 dark:bg-red-500"
              note={
                scores.claims
                  ? `${scores.contradicted + scores.unconfirmed} of ${scores.claims} claim${scores.claims === 1 ? "" : "s"} false or reported nowhere`
                  : "No checkable claims"
              }
            />
            <Meter
              label="Fact score"
              value={scores.factScore}
              max={100}
              unit="/100"
              bar={factBar(scores.factScore)}
              note={scores.factScore === null ? "Not scored" : "How well trusted sources back it up"}
            />
          </div>
        </div>
      </section>

      {/* Here's what's actually happening, when the message isn't true */}
      {realNews && realNews.points.length > 0 && (
        <section className="overflow-hidden rounded-2xl border bg-card">
          <div className="p-5 sm:p-6">
            <p className="text-lg font-semibold">
              Here&apos;s what&apos;s <strong>actually</strong> happening 👇
            </p>
            <ul className="mt-3 space-y-2.5">
              {realNews.points.map((p, i) => (
                <li key={i} className="flex gap-2 text-[15px] leading-relaxed">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-foreground/60" aria-hidden />
                  <span>{p.text}</span>
                </li>
              ))}
            </ul>
          </div>
          {reads.length > 0 && (
            <div className="divide-y border-t">
              {reads.map((p) => (
                <SourceLink
                  key={p.link}
                  link={links[p.link]}
                  className="flex items-center justify-center gap-2 px-4 py-3 text-[15px] font-medium text-emerald-700 hover:bg-muted hover:no-underline dark:text-emerald-400"
                >
                  <ExternalLink className="size-4 shrink-0" />
                  Read: {p.label || links[p.link].source}
                </SourceLink>
              ))}
            </div>
          )}
        </section>
      )}

      {/* DailyMattr PIX on this news */}
      {pix.length > 0 && (
        <section>
          <h2 className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
            {confirmed ? "Reported on DailyMattr" : "On DailyMattr"}
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pix.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/pix/${p.id}`}
                  className="flex gap-3 overflow-hidden rounded-xl border bg-card p-2 transition-colors hover:bg-muted"
                >
                  <PixImage src={p.image} alt="" size={[160, 160]} className="size-20 shrink-0 rounded-lg" />
                  <div className="min-w-0 py-1">
                    <p className="line-clamp-3 text-sm font-semibold leading-snug">{p.headline}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      DailyMattr PIX{p.published_at ? ` · ${fmtDate(p.published_at)}` : ""}
                      {!p.sameStory && " · related"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Every source, DailyMattr first */}
      {links.some((l) => l.kind !== "dailymattr") && (
        <section className="rounded-xl border bg-card p-5 sm:p-6">
          <h2 className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
            {confirmed ? "Confirmed by" : "Sources"}
          </h2>
          <ol className="mt-3 space-y-3">
            {links
              .filter((l) => l.kind !== "dailymattr")
              .map((l) => (
                <li key={l.url} className="text-[15px]">
                  <SourceLink link={l} className="inline-flex items-start gap-1 font-semibold">
                    {l.title} <ExternalLink className="mt-1 size-3.5 shrink-0" />
                  </SourceLink>
                  <div className="text-sm text-muted-foreground">
                    {l.source} · {KIND_LABEL[l.kind]}
                    {l.rating && ` · rated “${l.rating}”`}
                  </div>
                </li>
              ))}
          </ol>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setDetails((d) => !d)}
          aria-expanded={details}
          className="inline-flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm font-semibold shadow-xs transition-colors hover:bg-muted"
        >
          How this was checked
          <ChevronDown className={cn("size-4 transition-transform", details && "rotate-180")} />
        </button>
        {result.cached && (
          <span className="text-xs text-muted-foreground">
            Saved result from {fmtDate(report.checked_at)}.{" "}
            <button type="button" onClick={onRecheck} className="underline underline-offset-4 hover:text-foreground">
              Check again
            </button>
          </span>
        )}
      </div>
      {details && <FactReport report={report} showVerdict={false} />}
    </>
  );
}

const factBar = (score: number | null) =>
  score === null
    ? "bg-zinc-400"
    : score >= 85
      ? "bg-emerald-600 dark:bg-emerald-500"
      : score >= 65
        ? "bg-teal-600 dark:bg-teal-500"
        : score >= 40
          ? "bg-amber-500"
          : "bg-red-600 dark:bg-red-500";

function Meter({
  label,
  value,
  max,
  unit,
  bar,
  note,
}: {
  label: string;
  value: number | null;
  max: number;
  unit: string;
  bar: string;
  note: string;
}) {
  return (
    <div className="rounded-xl bg-background/70 p-3 text-foreground">
      <div className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5 text-3xl font-extrabold tabular-nums">
        {value ?? "–"}
        {value !== null && <span className="text-base font-semibold text-muted-foreground">{unit}</span>}
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value ?? undefined}
      >
        <div className={cn("h-full rounded-full", bar)} style={{ width: `${value === null ? 0 : (100 * value) / max}%` }} />
      </div>
      <div className="mt-1.5 text-xs leading-snug text-muted-foreground">{note}</div>
    </div>
  );
}

/** DailyMattr PIX open in this app; everything else in a new tab. */
function SourceLink({ link, className, children }: { link: TextLink; className?: string; children: React.ReactNode }) {
  if (link.kind === "dailymattr") {
    return (
      <Link href={link.url} className={cn("hover:underline", className)}>
        {children}
      </Link>
    );
  }
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer" className={cn("hover:underline", className)}>
      {children}
    </a>
  );
}
