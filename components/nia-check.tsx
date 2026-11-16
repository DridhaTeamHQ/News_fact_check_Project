"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  ExternalLink,
  FileSearch,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Quote,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { PixImage } from "@/components/pix-image";
import { RichText } from "@/components/rich-text";
import {
  CHECK_FAILED,
  type ChatCheck,
  type ChatQuestion,
  type PageCheck,
  type PageClaim,
  type RelatedPix,
} from "@/lib/chat-text";
import { cn } from "@/lib/utils";

/* "Fact check by NIA": paste a forward or a news link, press Fact check, get
 * NIA's verdict, its explanation and every claim marked true, partly true,
 * false or not confirmed, then the DailyMattr stories we've covered on the
 * same or nearby topics. Replies come from /api/nia (the chat's check, plus
 * the story, the claims and a wider related list). Follow-up questions are
 * answered by /api/chat-demo, which keeps the checked news for this reader. */

const MIN_LENGTH = 15;
const MAX_LENGTH = 5000;
const isLink = (text: string) => /^(https?:\/\/|www\.)\S+\.\S+$/i.test(text.trim());
const canCheck = (text: string) => isLink(text) || text.trim().length >= MIN_LENGTH;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
/** PIX headlines mark highlighted words with (round) or [square] brackets for
 * the card design; on the site they read as plain text. */
const plain = (headline: string) => headline.replace(/[()[\]]/g, "").replace(/\s+/g, " ").trim();

/** The site a link is on ("livemint.com"), or null. */
function hostOf(text: string): string | null {
  try {
    const t = text.trim();
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** What NIA says it is doing (time-based: the API reports no progress). */
const LINK_STEPS = [
  "Reading the article",
  "Pulling out every claim",
  "Finding other outlets",
  "Checking each claim",
  "Asking fact-checkers",
  "Searching DailyMattr",
  "Writing the summary",
];
const TEXT_STEPS = [
  "Reading the message",
  "Pulling out every claim",
  "Asking fact-checkers",
  "Searching the news",
  "Checking each claim",
  "Searching DailyMattr",
  "Writing the summary",
];
const STEP_MS = 7_000;

/* ---------- verdict and claim styles ---------- */

type Verdict = ChatCheck["verdict"];
type Tone = "true" | "partly" | "false" | "none";

const TONE: Record<Tone, { text: string; soft: string; bar: string; ring: string; glow: string }> = {
  true: {
    text: "text-emerald-700 dark:text-emerald-400",
    soft: "bg-emerald-500/10 border-emerald-500/25",
    bar: "bg-emerald-500",
    ring: "#10b981",
    glow: "rgb(16 185 129 / 0.16)",
  },
  partly: {
    text: "text-amber-700 dark:text-amber-400",
    soft: "bg-amber-500/10 border-amber-500/30",
    bar: "bg-amber-500",
    ring: "#f59e0b",
    glow: "rgb(245 158 11 / 0.16)",
  },
  false: {
    text: "text-rose-700 dark:text-rose-400",
    soft: "bg-rose-500/10 border-rose-500/25",
    bar: "bg-rose-500",
    ring: "#f43f5e",
    glow: "rgb(244 63 94 / 0.16)",
  },
  none: {
    text: "text-zinc-600 dark:text-zinc-400",
    soft: "bg-zinc-500/10 border-zinc-500/25",
    bar: "bg-zinc-400 dark:bg-zinc-500",
    ring: "#a1a1aa",
    glow: "rgb(161 161 170 / 0.14)",
  },
};

const VERDICT: Record<Verdict, { tone: Tone; icon: typeof CircleCheck }> = {
  true: { tone: "true", icon: CircleCheck },
  "mostly-true": { tone: "true", icon: CircleCheck },
  "partly-false": { tone: "partly", icon: TriangleAlert },
  false: { tone: "false", icon: CircleX },
  unverified: { tone: "none", icon: CircleHelp },
};

const CLAIM: Record<PageClaim["verdict"], { tone: Tone; label: string; icon: typeof CircleCheck; hl: string; note: string }> = {
  supported: { tone: "true", label: "True", icon: CircleCheck, hl: "nia-hl-true", note: "Sources report the same" },
  "partially-supported": {
    tone: "partly",
    label: "Partly true",
    icon: TriangleAlert,
    hl: "nia-hl-partly",
    note: "Some details differ from the sources",
  },
  contradicted: { tone: "false", label: "False", icon: CircleX, hl: "nia-hl-false", note: "Sources say otherwise" },
  unsupported: { tone: "none", label: "Not confirmed", icon: CircleHelp, hl: "nia-hl-none", note: "No source reports this" },
};
const CLAIM_ORDER: PageClaim["verdict"][] = ["supported", "partially-supported", "contradicted", "unsupported"];

type Answer = { id: string; question: string; text: string | null };

const EMPTY = { story: null, related: [], claims: [] };

/* ---------- the section ---------- */

export function NiaCheck() {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ startedAt: number; steps: string[]; about: string } | null>(null);
  const [result, setResult] = useState<(PageCheck & { about: string }) | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const userId = useRef<string>("");
  const abort = useRef<AbortController | null>(null);
  const resultBox = useRef<HTMLDivElement>(null);

  // Show the progress, then the result, as soon as each appears.
  useEffect(() => {
    if (pending || result) resultBox.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pending, result]);

  async function factCheck() {
    const about = text.trim();
    if (pending || !canCheck(about)) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    userId.current = `web-${newId()}`; // each check starts a fresh conversation
    setResult(null);
    setAnswers([]);
    setPending({ startedAt: Date.now(), steps: isLink(about) ? LINK_STEPS : TEXT_STEPS, about });
    let next: PageCheck;
    try {
      const res = await fetch("/api/nia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: about, userId: userId.current }),
        signal: controller.signal,
      });
      const data = await res.json();
      next = data?.reply?.messages
        ? { ...EMPTY, ...data }
        : { reply: { kind: "error", messages: [{ text: data?.error ?? CHECK_FAILED }] }, ...EMPTY };
    } catch {
      if (abort.current !== controller) return; // replaced by a newer check
      next = { reply: { kind: "error", messages: [{ text: controller.signal.aborted ? "Stopped." : CHECK_FAILED }] }, ...EMPTY };
    }
    if (abort.current !== controller) return;
    abort.current = null;
    setPending(null);
    setResult({ ...next, about });
  }

  async function ask(q: ChatQuestion) {
    if (!result || answers.some((a) => a.id === q.id)) return;
    setAnswers((all) => [...all, { id: q.id, question: q.title, text: null }]);
    let reply = CHECK_FAILED;
    try {
      const res = await fetch("/api/chat-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "question", questionId: q.id, text: result.about, userId: userId.current }),
      });
      const data = await res.json();
      reply = data?.messages?.map((m: { text: string }) => m.text).join("\n\n") || CHECK_FAILED;
    } catch {
      // keep CHECK_FAILED
    }
    setAnswers((all) => all.map((a) => (a.id === q.id ? { ...a, text: reply } : a)));
  }

  const length = text.trim().length;
  const hint = isLink(text)
    ? "News link: NIA reads the article and checks it against other outlets."
    : length > 0 && length < MIN_LENGTH
      ? "Paste the whole message: this is too short to check."
      : text.length > MAX_LENGTH - 500
        ? `${text.length.toLocaleString("en-IN")} / ${MAX_LENGTH.toLocaleString("en-IN")} characters`
        : "Paste a forwarded message or a news link.";

  return (
    <>
      <section id="fact-check" className="relative scroll-mt-20 px-4 pt-20 sm:pt-28">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(50%_60%_at_50%_30%,rgb(57_121_255/0.10),transparent_70%)]"
          aria-hidden
        />
        <div className="mx-auto max-w-3xl text-center">
          <span className="relative mx-auto block size-14" aria-hidden>
            <Image
              src="/nia_logo.png"
              alt=""
              width={198}
              height={198}
              className="pointer-events-none size-full max-w-none scale-[1.94] select-none"
            />
          </span>
          <p className="mt-6 text-[11px] font-semibold tracking-[3px] text-primary uppercase dark:text-[#6b9aff]">
            Fact check by NIA
          </p>
          <h2 className="mt-3 text-[34px] leading-[1.08] font-bold tracking-[-1px] text-balance sm:text-[52px] sm:tracking-[-1.5px]">
            Is this news real?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-balance text-muted-foreground sm:text-base">
            Paste a link or a forward. NIA reads it, checks every claim against trusted outlets and fact-checkers,
            and shows you what&apos;s true.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void factCheck();
            }}
            className="mt-9 rounded-[24px] border bg-card p-2 text-left shadow-[0_18px_40px_-20px_rgb(10_10_11/0.25)] transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-[0_0_0_4px_rgb(57_121_255/0.11)] dark:shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)]"
          >
            <label htmlFor="nia-input" className="sr-only">
              News link or message to fact-check
            </label>
            <textarea
              id="nia-input"
              rows={3}
              maxLength={MAX_LENGTH}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void factCheck();
                }
              }}
              placeholder="https://… or paste the message here"
              className="block max-h-60 min-h-24 w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
            />
            <div className="flex flex-col gap-3 px-2 pt-1 pb-1 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground" aria-live="polite">
                {hint}
              </p>
              <button
                type="submit"
                disabled={pending !== null || !canCheck(text)}
                className="relative inline-flex h-11 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-[transform,background-color,box-shadow] outline-none hover:-translate-y-px hover:bg-[var(--brand-blue-hover)] hover:shadow-[0_12px_30px_rgb(57_121_255/0.28)] focus-visible:ring-3 focus-visible:ring-ring/40 disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none motion-reduce:hover:translate-y-0"
              >
                {pending ? (
                  <Loader2 className="size-4.5 animate-spin" aria-hidden />
                ) : (
                  <ShieldCheck className="size-4.5" aria-hidden />
                )}
                {pending ? "Checking…" : "Fact check"}
              </button>
            </div>
          </form>

          {!pending && !result && <HowItWorks />}
        </div>

        <div ref={resultBox} className="mx-auto max-w-5xl scroll-mt-24">
          {pending && (
            <Progress
              startedAt={pending.startedAt}
              steps={pending.steps}
              about={pending.about}
              onStop={() => abort.current?.abort()}
            />
          )}
          {result && <Result result={result} answers={answers} onAsk={ask} />}
        </div>
      </section>

      {result && result.related.length > 0 && <Related items={result.related} />}
    </>
  );
}

/* ---------- before the first check ---------- */

function HowItWorks() {
  const steps = [
    { icon: FileSearch, title: "Reads it", text: "The article or forward, word by word." },
    { icon: ListChecks, title: "Checks every claim", text: "Against trusted outlets and fact-checkers." },
    { icon: Sparkles, title: "Shows what's true", text: "Each claim marked true, partly true or false." },
  ];
  return (
    <ol className="mt-10 grid gap-3 text-left sm:grid-cols-3">
      {steps.map((s, i) => (
        <li key={s.title} className="nia-rise rounded-[20px] border bg-card/60 p-4" style={{ animationDelay: `${i * 90}ms` }}>
          <span className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <s.icon className="size-4.5" aria-hidden />
          </span>
          <p className="mt-3 text-sm font-bold">{s.title}</p>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

/* ---------- while checking ---------- */

function Progress({
  startedAt,
  steps,
  about,
  onStop,
}: {
  startedAt: number;
  steps: string[];
  about: string;
  onStop: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(timer);
  }, [startedAt]);
  const step = Math.min(Math.floor(elapsed / STEP_MS), steps.length - 1);
  // Eases toward 95%: it never claims to be done before the answer arrives.
  const percent = Math.round(95 * (1 - Math.exp(-elapsed / 22_000)));
  const seconds = Math.floor(elapsed / 1000);
  const host = isLink(about) ? hostOf(about) : null;

  return (
    <div className="nia-rise relative mt-10 overflow-hidden rounded-[28px] border bg-card shadow-[0_30px_80px_-40px_rgb(57_121_255/0.45)]" aria-live="polite">
      {/* progress bar */}
      <div className="h-1 w-full bg-muted" aria-hidden>
        <div
          className="nia-bar relative h-full overflow-hidden bg-gradient-to-r from-[#3979ff] to-[#8db4ff] transition-[width] duration-700 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
        {/* NIA at work */}
        <div className="flex flex-col items-center justify-center text-center">
          <div className="relative flex size-32 items-center justify-center" aria-hidden>
            <span className="nia-ripple absolute inset-3 rounded-full border border-[#3979ff]/40" />
            <span className="nia-ripple absolute inset-3 rounded-full border border-[#3979ff]/40" style={{ animationDelay: "0.8s" }} />
            <span className="nia-ripple absolute inset-3 rounded-full border border-[#3979ff]/40" style={{ animationDelay: "1.6s" }} />
            <span className="absolute inset-3 rounded-full bg-[radial-gradient(circle,rgb(57_121_255/0.22),transparent_70%)]" />
            <span className="nia-orbit absolute inset-1 rounded-full" />
            <span className="relative block size-14">
              <Image
                src="/nia_logo.png"
                alt=""
                width={198}
                height={198}
                className="pointer-events-none size-full max-w-none scale-[1.94] select-none"
              />
            </span>
          </div>
          <p className="mt-4 text-3xl font-bold tracking-tight tabular-nums">{percent}%</p>
          <p className="mt-1 text-xs font-medium text-muted-foreground tabular-nums">
            {seconds}s · usually 30–60s
          </p>
        </div>

        {/* the steps */}
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[3px] text-muted-foreground uppercase">NIA is checking</p>
              <p key={step} className="nia-rise nia-sheen mt-2 text-2xl font-bold tracking-[-0.02em] sm:text-[28px]">
                {steps[step]}…
              </p>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {host ? (
                  <>
                    Article on <span className="font-semibold text-foreground">{host}</span>
                  </>
                ) : (
                  <>“{about.slice(0, 90)}{about.length > 90 ? "…" : ""}”</>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Stop
            </button>
          </div>

          <ol className="relative mt-6">
            {steps.map((s, i) => {
              const done = i < step;
              const now = i === step;
              return (
                <li key={s} className="relative flex items-center gap-3.5 pb-3.5 last:pb-0">
                  {i < steps.length - 1 && (
                    <span className="absolute top-6 bottom-0 left-[11px] w-0.5 overflow-hidden rounded-full bg-border" aria-hidden>
                      <span
                        className="block w-full bg-[#3979ff] transition-[height] duration-700 ease-out"
                        style={{ height: done ? "100%" : "0%" }}
                      />
                    </span>
                  )}
                  <span
                    className={cn(
                      "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 bg-card transition-colors duration-300",
                      done && "border-[#3979ff] bg-[#3979ff] text-white",
                      now && "border-[#3979ff]",
                      !done && !now && "border-border",
                    )}
                    aria-hidden
                  >
                    {done ? (
                      <Check className="nia-pop size-3.5" strokeWidth={3} />
                    ) : now ? (
                      <span className="size-2 animate-pulse rounded-full bg-[#3979ff] motion-reduce:animate-none" />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "text-[15px] transition-colors duration-300",
                      done && "text-foreground",
                      now && "font-semibold text-foreground",
                      !done && !now && "text-muted-foreground/60",
                    )}
                  >
                    {s}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* a glimpse of the result to come */}
      <div className="space-y-2.5 border-t px-6 py-5 sm:px-8" aria-hidden>
        <div className="nia-skeleton h-3 w-1/3 rounded-full" />
        <div className="nia-skeleton h-3 w-11/12 rounded-full" />
        <div className="nia-skeleton h-3 w-4/5 rounded-full" />
      </div>
    </div>
  );
}

/* ---------- the result ---------- */

/** The ring with the fact score (or the verdict's percentage). */
function ScoreRing({ value, color, label }: { value: number; color: string; label: string }) {
  const r = 42;
  const length = 2 * Math.PI * r;
  const offset = length * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={`${label}: ${value} out of 100`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" className="stroke-foreground/10" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={offset}
          className="nia-draw"
          style={{ ["--nia-ring-length" as string]: `${length}` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tracking-tight tabular-nums">{value}</span>
        <span className="text-[9px] font-semibold tracking-[1.5px] text-muted-foreground uppercase">{label}</span>
      </div>
    </div>
  );
}

function Result({
  result,
  answers,
  onAsk,
}: {
  result: PageCheck;
  answers: Answer[];
  onAsk: (q: ChatQuestion) => void;
}) {
  const { reply, story, claims } = result;
  const check = reply.check;

  // Not news, an unreadable link, or a failed check: NIA's message on its own.
  if (!check) {
    return (
      <div className="nia-rise mx-auto mt-10 flex max-w-3xl gap-4 rounded-[24px] border bg-card p-6 text-[15px] leading-relaxed sm:p-7">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <RichText text={reply.messages.map((m) => m.text).join("\n\n")} />
        </div>
      </div>
    );
  }

  const { tone, icon: Icon } = VERDICT[check.verdict];
  const t = TONE[tone];
  const score = check.factScore ?? check.percent;
  const scoreLabel = check.factScore !== null ? "Fact score" : (check.percentOf ?? "");
  // NIA's first message: the verdict line (the badge shows it), a title, the
  // article's headline for a link (shown above), the reason (in the header)
  // and advice. What's left is the explanation.
  const paras = reply.messages[0]?.text.split(/\n{2,}/).slice(1) ?? [];
  const title = paras[0] ?? "";
  const explanation = paras
    .slice(1)
    .filter((p) => !/^📰 _[\s\S]*_$/.test(p.trim()) && p.trim() !== check.reason.trim())
    .join("\n\n");
  const sources = check.sources.filter((s) => s.kind !== "dailymattr");
  const lead = check.dailyMattr;

  return (
    <article className="nia-rise mt-10 overflow-hidden rounded-[28px] border bg-card shadow-[0_30px_80px_-50px_rgb(10_10_11/0.5)]">
      {/* the verdict */}
      <header
        className="relative flex flex-col gap-6 border-b p-6 sm:flex-row sm:items-center sm:p-8"
        style={{ backgroundImage: `radial-gradient(80% 140% at 0% 0%, ${t.glow}, transparent 70%)` }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[3px] text-muted-foreground uppercase">NIA&apos;s verdict</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className={cn("flex items-center gap-2.5 text-4xl font-bold tracking-[-1px] sm:text-5xl", t.text)}>
              <Icon className="size-9 sm:size-11" strokeWidth={2.25} aria-hidden />
              {check.verdictWord}
            </span>
            {check.percent !== null && check.percentOf && (
              <span className={cn("rounded-full border px-3 py-1 text-xs font-bold tracking-[0.08em] uppercase", t.soft, t.text)}>
                {check.percent}% {check.percentOf}
              </span>
            )}
          </div>
          {title && (
            <div className="mt-3 text-base font-semibold">
              <RichText text={title} />
            </div>
          )}
          <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{check.reason}</p>
        </div>
        {score !== null && <ScoreRing value={score} color={t.ring} label={scoreLabel} />}
      </header>

      <div className="grid gap-10 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* main column */}
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[3px] text-muted-foreground uppercase">
            {check.input === "link" ? "The article" : "The claim"}
          </p>
          <h3 className="mt-2 text-xl leading-snug font-bold tracking-[-0.02em] sm:text-2xl">{check.claim}</h3>

          {explanation && (
            <div className="mt-4 text-[15px] leading-relaxed text-foreground/85">
              <RichText text={explanation} />
            </div>
          )}

          {story && (
            <section className="mt-8 rounded-[20px] border-l-4 border-[#3979ff] bg-muted/60 p-5 sm:p-6">
              <h4 className="text-[11px] font-semibold tracking-[3px] text-primary uppercase dark:text-[#6b9aff]">
                What happened
              </h4>
              <div className="mt-3 text-[15px] leading-[1.75]">
                <RichText text={story} />
              </div>
            </section>
          )}

          {claims.length > 0 && <ClaimBreakdown claims={claims} />}

          {reply.questions && reply.questions.length > 0 && (
            <Questions questions={reply.questions} answers={answers} onAsk={onAsk} />
          )}
        </div>

        {/* side column */}
        <aside className="min-w-0 space-y-8 lg:sticky lg:top-24 lg:self-start">
          {lead && (
            <a
              href={lead.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block overflow-hidden rounded-[20px] border bg-background transition-[border-color,box-shadow,transform] outline-none hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_18px_36px_-12px_rgb(10_10_11/0.25)] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
            >
              <span className="relative block aspect-[4/3] overflow-hidden bg-muted">
                <PixImage
                  src={lead.image}
                  alt=""
                  size={[600, 450]}
                  className="size-full object-top transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none"
                />
                <span className="absolute top-3 left-3 rounded-full bg-white/92 px-2.5 py-1 text-[10.5px] font-bold tracking-[0.08em] text-[#141417] uppercase shadow-[0_2px_8px_rgb(10_10_11/0.12)]">
                  On DailyMattr
                </span>
              </span>
              <span className="block p-4">
                <span className="line-clamp-3 block font-semibold leading-snug group-hover:text-accent-foreground">
                  {plain(lead.title)}
                </span>
                <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-primary dark:text-[#6b9aff]">
                  Read the story <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </span>
            </a>
          )}
          {sources.length > 0 && <Sources sources={sources} />}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Checks are automated. Open the sources to confirm.
          </p>
        </aside>
      </div>
    </article>
  );
}

/* ---------- claim by claim ---------- */

function ClaimBreakdown({ claims }: { claims: PageClaim[] }) {
  const [filter, setFilter] = useState<PageClaim["verdict"] | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const counts = useMemo(() => {
    const c = { supported: 0, "partially-supported": 0, contradicted: 0, unsupported: 0 } as Record<PageClaim["verdict"], number>;
    for (const claim of claims) c[claim.verdict]++;
    return c;
  }, [claims]);
  const present = CLAIM_ORDER.filter((v) => counts[v] > 0);
  const filtered = filter === "all" ? claims : claims.filter((c) => c.verdict === filter);
  const LIMIT = 6;
  const shown = showAll ? filtered : filtered.slice(0, LIMIT);

  return (
    <section className="mt-10" aria-labelledby="claims-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold tracking-[3px] text-muted-foreground uppercase">Claim by claim</p>
          <h4 id="claims-title" className="mt-1.5 text-lg font-bold tracking-[-0.01em]">
            What&apos;s true in this story
          </h4>
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          {claims.length} claim{claims.length === 1 ? "" : "s"} checked
        </p>
      </div>

      {/* the share of each verdict, as one bar */}
      <div className="mt-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {present.map((v) => (
          <span
            key={v}
            className={cn("h-full transition-[flex-grow] duration-700", TONE[CLAIM[v].tone].bar)}
            style={{ flexGrow: counts[v] }}
          />
        ))}
      </div>

      {/* the filter, which is also the legend */}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Show claims">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="tabular-nums opacity-70">{claims.length}</span>
        </FilterChip>
        {present.map((v) => (
          <FilterChip key={v} active={filter === v} onClick={() => setFilter(v)}>
            <span className={cn("size-2 rounded-full", TONE[CLAIM[v].tone].bar)} aria-hidden />
            {CLAIM[v].label} <span className="tabular-nums opacity-70">{counts[v]}</span>
          </FilterChip>
        ))}
      </div>

      <ol className="mt-5 space-y-3">
        {shown.map((c, i) => (
          <ClaimItem key={`${filter}-${i}`} claim={c} index={i} />
        ))}
      </ol>

      {filtered.length > LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline focus-visible:underline dark:text-[#6b9aff]"
        >
          {showAll ? "Show fewer" : `Show all ${filtered.length} claims`}
          <ChevronDown className={cn("size-4 transition-transform", showAll && "rotate-180")} aria-hidden />
        </button>
      )}
    </section>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-foreground bg-foreground text-background" : "bg-card hover:border-foreground/30",
      )}
    >
      {children}
    </button>
  );
}

function ClaimItem({ claim, index }: { claim: PageClaim; index: number }) {
  const [open, setOpen] = useState(false);
  const meta = CLAIM[claim.verdict];
  const t = TONE[meta.tone];
  const Icon = meta.icon;
  return (
    <li
      className="nia-rise relative overflow-hidden rounded-[18px] border bg-background"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", t.bar)} aria-hidden />
      <div className="py-4 pr-4 pl-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold", t.soft, t.text)}>
            <Icon className="size-3.5" aria-hidden />
            {meta.label}
          </span>
          <span className="text-xs text-muted-foreground">{meta.note}</span>
        </div>
        <p className="mt-2.5 text-[15px] leading-[1.7]">
          <mark className={cn("nia-hl bg-transparent text-foreground", meta.hl)}>{claim.claim}</mark>
        </p>
        {claim.evidence && (
          <>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground"
            >
              {open ? "Hide" : "What the sources say"}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
            </button>
            {open && (
              <blockquote className="nia-rise mt-2.5 flex gap-2.5 rounded-xl bg-muted/70 p-3.5 text-sm leading-relaxed text-foreground/85">
                <Quote className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>{claim.evidence}</span>
              </blockquote>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/* ---------- follow-up questions ---------- */

function Questions({
  questions,
  answers,
  onAsk,
}: {
  questions: ChatQuestion[];
  answers: Answer[];
  onAsk: (q: ChatQuestion) => void;
}) {
  return (
    <section className="mt-10 rounded-[20px] border bg-accent/40 p-5 sm:p-6">
      <h4 className="flex items-center gap-2 text-[11px] font-semibold tracking-[3px] text-primary uppercase dark:text-[#6b9aff]">
        <MessageCircleQuestion className="size-4" aria-hidden /> Ask NIA about this news
      </h4>
      <ul className="mt-4 flex flex-wrap gap-2">
        {questions.map((q) => {
          const asked = answers.some((a) => a.id === q.id);
          return (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => onAsk(q)}
                disabled={asked}
                title={q.description}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary/35 bg-card px-4 py-1.5 text-left text-sm font-medium text-accent-foreground transition-colors outline-none hover:border-primary hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {q.title}
                {asked && <Check className="size-3.5" aria-label="Asked" />}
              </button>
            </li>
          );
        })}
      </ul>
      {answers.map((a) => (
        <div key={a.id} className="nia-rise mt-4 rounded-[16px] border bg-card p-5" aria-live="polite">
          <p className="text-sm font-bold">{a.question}</p>
          <div className="mt-2 text-[15px] leading-relaxed text-foreground/90">
            {a.text === null ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> NIA is writing…
              </span>
            ) : (
              <RichText text={a.text} />
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

/* ---------- sources ---------- */

const SHOWN_SOURCES = 5;

function Sources({ sources }: { sources: ChatCheck["sources"] }) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, SHOWN_SOURCES);
  return (
    <section>
      <h4 className="text-[11px] font-semibold tracking-[3px] text-muted-foreground uppercase">
        Sources checked · {sources.length}
      </h4>
      <ul className="mt-3 space-y-1">
        {shown.map((s) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group -mx-2 flex items-start gap-2.5 rounded-xl px-2 py-2 transition-colors outline-none hover:bg-accent focus-visible:bg-accent"
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold uppercase">
                {s.source.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-[13px] leading-snug font-semibold group-hover:text-accent-foreground">
                  {s.title}
                </span>
                <span className="mt-0.5 block text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {s.source}
                  {s.kind === "fact-check" && " · Fact-check"}
                </span>
              </span>
              <ExternalLink className="mt-1 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      {sources.length > SHOWN_SOURCES && (
        <button
          type="button"
          onClick={() => setAll((a) => !a)}
          className="mt-2 text-[13px] font-semibold text-primary hover:underline focus-visible:underline dark:text-[#6b9aff]"
        >
          {all ? "Show fewer" : `Show all ${sources.length}`}
        </button>
      )}
    </section>
  );
}

/* ---------- related PIX ---------- */

function Related({ items }: { items: RelatedPix[] }) {
  return (
    <section aria-labelledby="related-title" className="mx-auto mt-24 max-w-7xl scroll-mt-24 px-4 sm:px-8">
      <div className="flex items-end gap-5">
        <div>
          <p className="text-[11px] font-semibold tracking-[3px] text-primary uppercase dark:text-[#6b9aff]">
            From DailyMattr
          </p>
          <h2 id="related-title" className="mt-2 text-2xl font-bold tracking-[-0.02em] sm:text-[32px]">
            Related stories we&apos;ve covered
          </h2>
        </div>
        <span className="mb-3 hidden h-px flex-1 bg-border sm:block" aria-hidden />
      </div>
      <ul className="mt-8 grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
        {items.map((p, i) => (
          <li key={p.id} className="nia-rise" style={{ animationDelay: `${Math.min(i, 8) * 70}ms` }}>
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col overflow-hidden rounded-[20px] border bg-card shadow-[0_1px_2px_rgb(10_10_11/0.04)] transition-[transform,box-shadow,border-color] duration-250 outline-none hover:-translate-y-1 hover:shadow-[0_18px_36px_-12px_rgb(10_10_11/0.18)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:hover:translate-y-0"
            >
              <span className="relative block aspect-[4/5] overflow-hidden bg-muted">
                <PixImage
                  src={p.image}
                  alt=""
                  size={[480, 600]}
                  className="size-full object-top transition-transform duration-500 group-hover:scale-[1.05] motion-reduce:transition-none"
                />
                {(p.sameStory || p.category) && (
                  <span className="absolute top-3 left-3 rounded-full bg-white/92 px-2.5 py-1 text-[10.5px] font-bold tracking-[0.08em] text-[#141417] uppercase shadow-[0_2px_8px_rgb(10_10_11/0.12)] backdrop-blur-sm">
                    {p.sameStory ? "Same story" : p.category}
                  </span>
                )}
              </span>
              <span className="flex flex-1 flex-col gap-3 p-4 sm:p-[18px]">
                <span className="line-clamp-3 text-[15px] leading-[1.38] font-semibold tracking-[-0.01em] group-hover:text-primary sm:text-[16.5px]">
                  {plain(p.headline)}
                </span>
                <span className="mt-auto text-[12.5px] font-semibold text-primary dark:text-[#6b9aff]">Read →</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
