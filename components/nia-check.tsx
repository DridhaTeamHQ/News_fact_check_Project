"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Baby,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock3,
  ExternalLink,
  FastForward,
  FileSearch,
  Hash,
  Lightbulb,
  ListChecks,
  ListOrdered,
  Loader2,
  Newspaper,
  Quote,
  RefreshCw,
  Scale,
  ScanSearch,
  SearchX,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { OutletLogo } from "@/components/outlet-logo";
import { PixImage } from "@/components/pix-image";
import { Reveal } from "@/components/reveal";
import { RichText } from "@/components/rich-text";
import {
  CHECK_FAILED,
  type ChatCheck,
  type ChatQuestion,
  type PageCheck,
  type Correction,
  type PageClaim,
  type RelatedPix,
} from "@/lib/chat-text";
import { logoSite } from "@/lib/outlets";
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

const EMPTY = { story: null, related: [], claims: [], correction: null, views: [] };

/** Give up waiting a little after the server's own 120 s limit. */
const CLIENT_TIMEOUT_MS = 130_000;
/** How long the finished progress (100%, every step ticked) shows before the result. */
const FINISH_MS = 650;
const TOO_SLOW = "⌛ This check is taking too long. Please try again in a minute.";
const OFFLINE = "📡 You seem to be offline. Check your connection and try again.";

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const smooth = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/** An error shown in place of a result. */
const failed = (text: string): PageCheck => ({ reply: { kind: "error", messages: [{ text }] }, ...EMPTY });

/** The API's answer with every list present, so a missing field can't break the page. */
function normalize(data: unknown): PageCheck | null {
  const d = data as Partial<PageCheck> | null;
  if (!d?.reply || !Array.isArray(d.reply.messages)) return null;
  const check = d.reply.check ? { ...d.reply.check, sources: d.reply.check.sources ?? [] } : undefined;
  return {
    reply: { ...d.reply, ...(check ? { check } : {}) },
    story: typeof d.story === "string" && d.story.trim() ? d.story : null,
    related: Array.isArray(d.related) ? d.related : [],
    claims: Array.isArray(d.claims) ? d.claims : [],
    correction:
      d.correction && Array.isArray(d.correction.points)
        ? {
            headline: d.correction.headline || null,
            points: d.correction.points.filter((x) => x && typeof x.text === "string" && x.text.trim()),
            advice: Array.isArray(d.correction.advice) ? d.correction.advice.filter(Boolean) : [],
          }
        : null,
    views: Array.isArray(d.views) ? d.views.filter((v) => v && typeof v.id === "string" && typeof v.title === "string") : [],
  };
}

type Pending = { startedAt: number; steps: string[]; about: string; done?: boolean };

/* ---------- the section ---------- */

export function NiaCheck() {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<(PageCheck & { about: string }) | null>(null);
  const userId = useRef<string>("");
  const abort = useRef<AbortController | null>(null);
  const busy = useRef(false); // a check is running or finishing (state can lag a fast double click)
  const input = useRef<HTMLTextAreaElement>(null);
  const resultBox = useRef<HTMLDivElement>(null);

  // Text typed or pasted before the page finished loading is in the box but
  // not in state: pick it up, so the button isn't stuck disabled.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const typed = input.current?.value ?? "";
      if (typed) setText((t) => t || typed);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Bring the progress into view when a check starts, if it's out of sight.
  const startedAt = pending?.startedAt;
  useEffect(() => {
    const box = resultBox.current;
    if (!startedAt || !box) return;
    const top = box.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.7 || top < 0) box.scrollIntoView({ behavior: smooth(), block: "start" });
  }, [startedAt]);

  // The result takes the progress's place: scroll only if its top is out of sight.
  useEffect(() => {
    const box = resultBox.current;
    if (!result || !box) return;
    const top = box.getBoundingClientRect().top;
    if (top < 56 || top > window.innerHeight * 0.6) box.scrollIntoView({ behavior: smooth(), block: "start" });
  }, [result]);

  /** Check `given`, or what's in the box. */
  async function factCheck(given?: string) {
    const about = (given ?? input.current?.value ?? text).trim();
    if (busy.current || !canCheck(about)) return;
    busy.current = true;
    const controller = new AbortController();
    abort.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CLIENT_TIMEOUT_MS);
    userId.current = `web-${newId()}`; // each check starts a fresh conversation
    setResult(null);
    setPending({ startedAt: Date.now(), steps: isLink(about) ? LINK_STEPS : TEXT_STEPS, about });

    let next: PageCheck;
    try {
      const res = await fetch("/api/nia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: about, userId: userId.current }),
        signal: controller.signal,
      });
      const data: unknown = await res.json().catch(() => null);
      next =
        normalize(data) ??
        failed((data as { error?: string } | null)?.error ?? (res.status === 504 ? TOO_SLOW : CHECK_FAILED));
    } catch {
      clearTimeout(timer);
      abort.current = null;
      if (!timedOut && controller.signal.aborted) {
        // Stopped by the reader: back to the box, nothing to show.
        busy.current = false;
        setPending(null);
        return;
      }
      next = failed(navigator.onLine === false ? OFFLINE : timedOut ? TOO_SLOW : CHECK_FAILED);
    }
    clearTimeout(timer);
    abort.current = null;

    // Let the progress finish (100%, every step ticked), then hand over.
    setPending((p) => (p ? { ...p, done: true } : p));
    await sleep(FINISH_MS);
    setPending(null);
    setResult({ ...next, about });
    busy.current = false;
  }

  /** One "see it another way" view of the checked news, written by NIA from
   * that news's sources. Throws on failure (the view offers a retry). */
  async function loadView(view: ChatQuestion): Promise<string> {
    if (!result) throw new Error("no result");
    const res = await fetch("/api/chat-demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "question", questionId: view.id, text: result.about, userId: userId.current }),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => null)) as { kind?: string; messages?: { text?: string }[] } | null;
    const text = data?.messages
      ?.map((m) => m.text ?? "")
      .filter(Boolean)
      .join("\n\n");
    if (!res.ok || !text || data?.kind === "error") throw new Error(text || CHECK_FAILED);
    // The answer opens with its own "🔁 *Title*" line: the panel shows the title.
    return text.replace(/^\S+ \*[^*\n]+\*\s*\n+/, "").trim();
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
      {/* The hero: NIA's fact check, on the dark DailyMattr panel in both themes */}
      <section id="fact-check" className="scroll-mt-20 px-2 pt-2 sm:px-4 sm:pt-3">
        <div className="nia-grain nia-top-light relative overflow-hidden rounded-[28px] border border-transparent bg-[radial-gradient(120%_90%_at_50%_0%,#1c1c1f_0%,#0a0a0b_58%)] text-white dark:border-white/[0.08]">
          {/* depth: a faint grid, drifting blue light, and faint rings */}
          <div className="nia-grid pointer-events-none absolute inset-0" aria-hidden />
          <div
            className="nia-aurora-a pointer-events-none absolute top-[8%] left-[18%] size-[520px] rounded-full bg-[radial-gradient(circle,rgb(57_121_255/0.28)_0%,transparent_65%)] blur-[60px]"
            aria-hidden
          />
          <div
            className="nia-aurora-b pointer-events-none absolute top-[30%] right-[12%] size-[460px] rounded-full bg-[radial-gradient(circle,rgb(124_92_255/0.18)_0%,transparent_65%)] blur-[60px]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute top-[38%] left-1/2 size-[760px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(57_121_255/0.16)_0%,transparent_60%)] blur-[40px]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full border border-[#4884ff]/10"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -top-64 -right-64 size-[780px] rounded-full border border-[#4884ff]/[0.07]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-56 -left-56 size-[620px] rounded-full border border-[#4884ff]/[0.07]"
            aria-hidden
          />

          <div className="relative mx-auto max-w-4xl px-5 pt-14 pb-16 text-center sm:pt-20 sm:pb-24">
            <div className="nia-rise relative mx-auto flex size-24 items-center justify-center" aria-hidden>
              <span className="nia-ripple absolute inset-3 rounded-full border border-[#3979ff]/40" />
              <span
                className="nia-ripple absolute inset-3 rounded-full border border-[#3979ff]/40"
                style={{ animationDelay: "1.2s" }}
              />
              <span className="nia-orbit nia-orbit-slow absolute inset-1 rounded-full" />
              <span className="relative block size-12">
                <Image
                  src="/nia_logo.png"
                  alt=""
                  width={198}
                  height={198}
                  priority
                  className="pointer-events-none size-full max-w-none scale-[1.94] select-none"
                />
              </span>
            </div>

            <p
              className="nia-rise mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-[11px] font-semibold tracking-[2.5px] text-[#8db4ff] uppercase"
              style={{ animationDelay: "60ms" }}
            >
              <span className="size-1.5 rounded-full bg-[#64d8a3] shadow-[0_0_0_3px_rgb(100_216_163/0.15)]" aria-hidden />
              Fact check by NIA
            </p>
            <h1
              className="nia-rise mt-5 text-[38px] leading-[1.1] font-bold tracking-[-1.5px] text-balance sm:text-[56px] lg:text-[64px] lg:tracking-[-2px]"
              style={{ animationDelay: "120ms" }}
            >
              Is this <RotatingWord /> real?
            </h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void factCheck();
              }}
              className="nia-rise nia-glow-ring mx-auto mt-10 max-w-3xl rounded-[26px] border border-white/12 bg-white/[0.06] p-2 text-left shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_30px_80px_-30px_rgb(0_0_0/0.8)] backdrop-blur-md transition-[border-color,background-color,box-shadow] focus-within:border-white/20 focus-within:bg-white/[0.08] focus-within:shadow-[0_0_0_4px_rgb(57_121_255/0.12),0_30px_80px_-30px_rgb(57_121_255/0.45)]"
              style={{ animationDelay: "240ms" }}
            >
              <label htmlFor="nia-input" className="sr-only">
                News link or message to fact-check
              </label>
              <textarea
                ref={input}
                id="nia-input"
                rows={3}
                maxLength={MAX_LENGTH}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  // A link pasted into an empty box is the whole message: check it at once.
                  const pasted = e.clipboardData.getData("text").trim();
                  if (!text.trim() && isLink(pasted) && !busy.current) {
                    e.preventDefault();
                    setText(pasted);
                    void factCheck(pasted);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void factCheck();
                  }
                }}
                placeholder="https://… or paste the message here"
                className="block max-h-60 min-h-24 w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-base leading-6 text-white caret-[#6b9aff] outline-none placeholder:text-white/40"
              />
              <div className="flex flex-col gap-3 px-2 pt-1 pb-1 sm:flex-row sm:items-center">
                <p className="min-w-0 flex-1 text-xs leading-snug text-white/50" aria-live="polite">
                  {hint}
                </p>
                <span className="hidden items-center gap-1.5 text-[11px] text-white/35 sm:flex" aria-hidden>
                  <kbd className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 font-sans text-[10px] text-white/60">
                    Enter ↵
                  </kbd>
                  to check
                </span>
                <button
                  type="submit"
                  disabled={pending !== null || !canCheck(text)}
                  className="nia-shine group relative inline-flex h-12 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-b from-[#4a86ff] to-[#2f6af0] px-7 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_24px_-8px_rgb(57_121_255/0.7)] transition-[transform,box-shadow,filter] outline-none hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_14px_34px_-8px_rgb(57_121_255/0.85)] hover:brightness-110 focus-visible:ring-3 focus-visible:ring-[#6b9aff]/50 active:translate-y-0 active:scale-[0.98] disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none motion-reduce:hover:translate-y-0"
                >
                  {pending ? (
                    <Loader2 className="size-4.5 animate-spin" aria-hidden />
                  ) : (
                    <ShieldCheck className="size-4.5" aria-hidden />
                  )}
                  {pending ? "Checking…" : "Fact check"}
                  {!pending && (
                    <ArrowRight
                      className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  )}
                </button>
              </div>
            </form>

            {/* what NIA does, under the box */}
            <p
              className="nia-rise mx-auto mt-5 max-w-2xl text-[15px] leading-relaxed text-balance text-white/65"
              style={{ animationDelay: "270ms" }}
            >
              Paste a news link or a forwarded message. NIA checks every claim against trusted outlets and
              fact-checkers, and tells you what&apos;s really true.
            </p>

            {/* one-tap examples */}
            <div
              className="nia-rise mt-5 flex flex-wrap items-center justify-center gap-2"
              style={{ animationDelay: "300ms" }}
            >
              <span className="text-xs font-medium text-white/45">Try:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  disabled={pending !== null}
                  onClick={() => {
                    setText(ex.text);
                    void factCheck(ex.text);
                  }}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors outline-none hover:border-white/25 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[#6b9aff] disabled:opacity-40"
                >
                  {ex.label}
                </button>
              ))}
            </div>

            {/* what it checks against */}
            <div className="nia-rise mt-12" style={{ animationDelay: "360ms" }}>
              <p className="text-[10.5px] font-semibold tracking-[2.5px] text-white/35 uppercase">Checked against</p>
              <style href="nia-halo" precedence="default">{HALO_CSS}</style>
              <ul className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {TRUST.map((t) => (
                  <li
                    key={t.label}
                    className={cn(
                      "flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-[13px] text-white/70 backdrop-blur-sm",
                      t.glow && "nia-halo text-white/90",
                    )}
                  >
                    <t.icon className="size-4 text-[#6b9aff]" aria-hidden />
                    {t.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <div ref={resultBox} className="mx-auto max-w-6xl scroll-mt-24 px-4 sm:px-6">
        {pending && (
          <Progress
            startedAt={pending.startedAt}
            steps={pending.steps}
            about={pending.about}
            done={pending.done ?? false}
            onStop={() => abort.current?.abort()}
          />
        )}
        {result && <Result result={result} loadView={loadView} onRetry={() => void factCheck(result.about)} />}
      </div>

      {!pending && !result && <HowItWorks />}
      {result?.reply.check && <Related items={result.related} />}
      <CheckAnother after={result !== null} />
    </>
  );
}

/** Example checks, one tap each. */
const EXAMPLES = [
  { label: "₹1000 notes banned?", text: "PM Modi bans 1000 rupee notes" },
  {
    label: "₹500 + free 5G forward",
    text: "Breaking: RBI has announced that all old 500 rupee notes will stop being legal tender from 1 December and the government will give every citizen free 5G recharge for a year under the PM Digital Yojana. Forward to all!",
  },
  {
    label: "Anthropic IPO (Livemint link)",
    text: "https://www.livemint.com/companies/news/anthropic-ipo-why-google-s-13-stake-and-big-tech-s-900-billion-ai-bet-hinge-on-claude-maker-s-success-decoded-11794798914261.html",
  },
];

const TRUST = [
  { icon: Newspaper, label: "Trusted news outlets" },
  // BOOM, Alt News, PIB Fact Check, AFP… (lib/fact-checks.ts)
  { icon: ShieldCheck, label: "India's top fact-checkers", glow: true },
  { icon: BadgeCheck, label: "The dailymattr newsroom" },
];

/** A chip to draw the eye to: a blue light runs round its border, with a soft
 *  halo that breathes behind it. Kept here, not in globals.css, so it ships
 *  with the component even when a deploy reuses a cached stylesheet. */
const HALO_CSS = `
@property --nia-halo-angle { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
@keyframes nia-halo-turn { to { --nia-halo-angle: 360deg; } }
@keyframes nia-halo {
  0%, 100% { box-shadow: 0 0 0 1px rgb(57 121 255 / 0.25), 0 0 12px 0 rgb(57 121 255 / 0.18); }
  50% { box-shadow: 0 0 0 1px rgb(57 121 255 / 0.4), 0 0 22px 2px rgb(57 121 255 / 0.32); }
}
.nia-halo { position: relative; isolation: isolate; animation: nia-halo 3s ease-in-out infinite; }
.nia-halo::before {
  content: "";
  position: absolute;
  inset: -1px;
  z-index: 1;
  pointer-events: none;
  border-radius: inherit;
  padding: 1.5px;
  background: conic-gradient(from var(--nia-halo-angle), transparent 0deg, #3979ff 60deg, #b9d0ff 110deg, transparent 180deg, transparent 360deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  animation: nia-halo-turn 4s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .nia-halo, .nia-halo::before { animation: none; }
  .nia-halo { box-shadow: 0 0 0 1px rgb(57 121 255 / 0.4), 0 0 16px 0 rgb(57 121 255 / 0.25); }
}
`;

/** The hero's changing word, in a dark pill as on dailymattr.com. */
const WORDS = ["news", "forward", "link", "headline", "rumour"];

/** The hero's changing word: just the word, in brand blue. Its slot eases to
 * each word's width, so the headline stays centred without jumping. */
function RotatingWord() {
  const [i, setI] = useState(0);
  const [width, setWidth] = useState<number | null>(null); // null: natural width (before measuring)
  const sizes = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setI((n) => (n + 1) % WORDS.length), 2600);
    return () => clearInterval(timer);
  }, []);

  // Measure the word (again once the web font is in, and on resize).
  useEffect(() => {
    const measure = () => {
      const w = sizes.current[i]?.getBoundingClientRect().width;
      if (w) setWidth(Math.ceil(w));
    };
    measure();
    void document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [i]);

  return (
    <span
      className="relative inline-block h-[1.1em] overflow-hidden align-bottom transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      style={width ? { width } : undefined}
    >
      {/* the words at their natural size, for measuring only */}
      <span className="pointer-events-none invisible absolute top-0 left-0 whitespace-nowrap" aria-hidden>
        {WORDS.map((word, n) => (
          <span
            key={word}
            ref={(el) => {
              sizes.current[n] = el;
            }}
            className="absolute top-0 left-0"
          >
            {word}
          </span>
        ))}
      </span>
      <span
        key={i}
        className="nia-word inline-block bg-gradient-to-r from-[#6b9aff] to-[#b9cfff] bg-clip-text pb-[0.08em] whitespace-nowrap text-transparent"
      >
        {WORDS[i]}
      </span>
    </span>
  );
}

/* ---------- before the first check ---------- */

function HowItWorks() {
  const steps = [
    { icon: FileSearch, title: "Reads it", text: "The article or forward, word by word, and pulls out every claim." },
    { icon: ListChecks, title: "Checks every claim", text: "Against trusted outlets, fact-checkers and the DailyMattr newsroom." },
    { icon: Sparkles, title: "Shows what's true", text: "Each claim marked true, partly true or false, with the real facts." },
  ];
  return (
    <section id="how" aria-labelledby="how-title" className="mx-auto mt-24 max-w-6xl scroll-mt-24 px-4 sm:mt-28 sm:px-6">
      <Reveal className="text-center">
        <p className="text-[11px] font-semibold tracking-[3px] text-primary uppercase dark:text-[#6b9aff]">How it works</p>
        <h2 id="how-title" className="mt-3 text-[30px] leading-[1.1] font-bold tracking-[-1px] text-balance sm:text-[44px] sm:tracking-[-1.5px]">
          From forward to facts <span className="text-muted-foreground">in a minute</span>
        </h2>
      </Reveal>
      <ol className="relative mt-12 grid gap-4 sm:grid-cols-3 sm:gap-5">
        {/* the line joining the steps */}
        <span
          className="pointer-events-none absolute top-[52px] right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent sm:block"
          aria-hidden
        />
        {steps.map((s, i) => (
          <Reveal as="li" key={s.title} delay={i * 110}>
            <div className="group relative h-full overflow-hidden rounded-[24px] border bg-card p-7 shadow-[0_1px_2px_rgb(10_10_11/0.04)] transition-[transform,box-shadow,border-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_24px_50px_-24px_rgb(57_121_255/0.45)] motion-reduce:hover:translate-y-0">
              {/* the step number, large and faint */}
              <span
                className="pointer-events-none absolute -top-3 -right-1 text-[96px] leading-none font-extrabold tracking-[-4px] text-foreground/[0.04] select-none"
                aria-hidden
              >
                0{i + 1}
              </span>
              <span className="relative flex size-12 items-center justify-center rounded-2xl bg-gradient-to-b from-[#4a86ff] to-[#2f6af0] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_10px_24px_-8px_rgb(57_121_255/0.7)] transition-transform duration-500 group-hover:scale-105">
                <s.icon className="size-5" aria-hidden />
              </span>
              <p className="relative mt-6 text-[11px] font-semibold tracking-[2px] text-muted-foreground uppercase">
                Step {i + 1}
              </p>
              <p className="relative mt-1.5 text-xl font-bold tracking-[-0.02em]">{s.title}</p>
              <p className="relative mt-2 text-[15px] leading-relaxed text-muted-foreground">{s.text}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

/** The closing call to action: back up to the box, ready to paste. */
function CheckAnother({ after }: { after: boolean }) {
  return (
    <Reveal className="mx-auto mt-24 max-w-6xl px-4 sm:mt-28 sm:px-6">
      <div className="nia-grain nia-top-light relative overflow-hidden rounded-[28px] bg-[radial-gradient(120%_140%_at_0%_0%,#4a86ff_0%,#2f6af0_45%,#1d48c4_100%)] px-6 py-12 text-white sm:px-12 sm:py-14">
        <div
          className="pointer-events-none absolute -top-24 -right-24 size-[360px] rounded-full border border-white/15"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -top-44 -right-44 size-[560px] rounded-full border border-white/10"
          aria-hidden
        />
        <div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <p className="text-[11px] font-semibold tracking-[3px] text-white/70 uppercase">
              {after ? "Got another one?" : "Got a forward?"}
            </p>
            <h2 className="mt-3 text-[28px] leading-[1.1] font-bold tracking-[-1px] sm:text-[38px]">
              Don&apos;t forward it until NIA has checked it.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-white/80">
              Paste any link or message. It&apos;s free, and it takes about a minute.
            </p>
          </div>
          <a
            href="#fact-check"
            onClick={() => {
              // Land in the box, ready to paste, once the scroll is under way.
              setTimeout(() => document.getElementById("nia-input")?.focus({ preventScroll: true }), 500);
            }}
            className="group inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-[#141417] shadow-[0_12px_30px_-10px_rgb(0_0_0/0.45)] transition-[transform,background-color] outline-none hover:-translate-y-px hover:bg-[#f2f2f7] focus-visible:ring-3 focus-visible:ring-white/60 active:scale-[0.98] motion-reduce:hover:translate-y-0"
          >
            <ShieldCheck className="size-4.5 text-[#3979ff]" aria-hidden />
            Fact check now
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden />
          </a>
        </div>
      </div>
    </Reveal>
  );
}

/* ---------- while checking ---------- */

function Progress({
  startedAt,
  steps,
  about,
  done,
  onStop,
}: {
  startedAt: number;
  steps: string[];
  about: string;
  done: boolean; // the answer is in: everything ticks over to finished
  onStop: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(timer);
  }, [startedAt, done]);
  // Done: every step ticked. Otherwise one step every few seconds, holding on the last.
  const step = done ? steps.length : Math.min(Math.floor(elapsed / STEP_MS), steps.length - 1);
  // Eases toward 95%: it never claims to be done before the answer arrives.
  const percent = done ? 100 : Math.round(95 * (1 - Math.exp(-elapsed / 22_000)));
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
              <p
                key={step}
                className={cn(
                  "nia-rise mt-2 text-2xl font-bold tracking-[-0.02em] sm:text-[28px]",
                  done ? "text-[#3979ff] dark:text-[#6b9aff]" : "nia-sheen",
                )}
              >
                {done ? "Done. Here's what NIA found" : `${steps[step]}…`}
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
              disabled={done}
              className="shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-[color,border-color,opacity] outline-none hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-0"
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

/** Counts from 0 up to `to` over about a second (at once with reduced motion). */
function useCountUp(to: number, ms = 1200): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setN(to));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const start = performance.now() + 200; // with the ring's own 0.2 s delay
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      setN(Math.round(to * (1 - Math.pow(1 - t, 3)))); // ease-out
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return n;
}

/** The ring with the fact score (or the verdict's percentage). */
function ScoreRing({ value, color, label }: { value: number; color: string; label: string }) {
  const shown = useCountUp(value);
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
          style={{ ["--nia-ring-length" as string]: `${length}`, filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tracking-tight tabular-nums">{shown}</span>
        <span className="text-[9px] font-semibold tracking-[1.5px] text-muted-foreground uppercase">{label}</span>
      </div>
    </div>
  );
}

function Result({
  result,
  loadView,
  onRetry,
}: {
  result: PageCheck;
  loadView: (view: ChatQuestion) => Promise<string>;
  onRetry: () => void;
}) {
  const { reply, story, claims, views } = result;
  const check = reply.check;
  // The view in the main panel: null is the default ("What's actually true"
  // or "What happened"); otherwise a view id. Loaded views are kept.
  const [active, setActive] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, ViewState>>({});
  const inflight = useRef(new Set<string>());
  const panel = useRef<HTMLDivElement>(null);

  async function openView(view: ChatQuestion | null) {
    setActive(view?.id ?? null);
    // On phones the menu sits above the panel: keep the panel in sight.
    const box = panel.current;
    if (box && box.getBoundingClientRect().top > window.innerHeight * 0.75) {
      box.scrollIntoView({ behavior: smooth(), block: "start" });
    }
    if (!view || inflight.current.has(view.id)) return;
    if (loaded[view.id]?.status === "done") return;
    inflight.current.add(view.id);
    setLoaded((all) => ({ ...all, [view.id]: { status: "loading", text: "" } }));
    try {
      const text = await loadView(view);
      setLoaded((all) => ({ ...all, [view.id]: { status: "done", text } }));
    } catch (err) {
      const message = err instanceof Error && err.message.length > 20 ? err.message : CHECK_FAILED;
      setLoaded((all) => ({ ...all, [view.id]: { status: "error", text: message } }));
    } finally {
      inflight.current.delete(view.id);
    }
  }

  // Not news, an unreadable link, or a failed check: NIA's message on its own.
  if (!check) {
    return (
      <div className="nia-rise mx-auto mt-10 flex max-w-3xl gap-4 rounded-[24px] border bg-card p-6 text-[15px] leading-relaxed sm:p-7">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <RichText text={reply.messages.map((m) => m.text).join("\n\n")} />
          {reply.kind === "error" && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[background-color,transform] outline-none hover:bg-[var(--brand-blue-hover)] focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.98]"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const { tone, icon: Icon } = VERDICT[check.verdict];
  const t = TONE[tone];
  // Only numbers that agree with the verdict: a fact-checker's rating can make
  // news false while most of its other claims still check out (score 42).
  const isTrue = tone === "true";
  const fakeShare = !isTrue && check.verdict !== "unverified" && check.fakePercent ? check.fakePercent : null;
  const score = isTrue ? (check.factScore ?? check.percent) : fakeShare;
  const scoreLabel = isTrue ? (check.factScore !== null ? "Fact score" : (check.percentOf ?? "")) : "% fake";
  const showPercent = check.percent !== null && check.percent > 0 && check.percentOf !== null;
  // NIA's first message: the verdict line (the badge shows it), a title, the
  // article's headline for a link (shown above), the reason (in the header)
  // and advice. What's left is the explanation.
  const paras = reply.messages[0]?.text.split(/\n{2,}/).slice(1) ?? [];
  const title = paras[0] ?? "";
  const correction = result.correction;
  // Shown elsewhere, so left out here: the reason (in the header), and with a
  // correction its headline and the advice ("✅ …"), which it shows in full.
  const shownElsewhere = [check.reason, correction?.headline ?? ""].map((x) => x.trim()).filter(Boolean);
  const explanation = paras
    .slice(1)
    .filter((p) => !/^📰 _[\s\S]*_$/.test(p.trim()))
    .filter((p) => !(correction && /^✅/.test(p.trim())))
    .map((p) => shownElsewhere.reduce((acc, x) => acc.replace(x, ""), p).trim())
    .filter((p) => p.replace(/[\s*_~.]/g, "").length > 0)
    .join("\n\n");
  const sources = check.sources.filter((s) => s.kind !== "dailymattr");
  const lead = check.dailyMattr;
  // The panel's own content before any view is picked.
  const defaultLabel = correction
    ? check.verdict === "unverified"
      ? "What we know"
      : "What's actually true"
    : story
      ? "What happened"
      : null;
  const activeView = views.find((v) => v.id === active) ?? null;

  return (
    <article className="nia-rise mt-10 overflow-hidden rounded-[28px] border bg-card shadow-[0_40px_100px_-60px_rgb(10_10_11/0.6)]">
      {/* the verdict, under a strip in its colour */}
      <div className={cn("h-1 w-full", t.bar)} aria-hidden />
      <header
        className="relative flex flex-col gap-6 overflow-hidden border-b p-6 sm:flex-row sm:items-center sm:p-9"
        style={{
          backgroundImage: `radial-gradient(70% 160% at 0% 0%, ${t.glow}, transparent 70%), radial-gradient(40% 120% at 100% 100%, ${t.glow}, transparent 70%)`,
        }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[3px] text-muted-foreground uppercase">NIA&apos;s verdict</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className={cn("flex items-center gap-2.5 text-4xl font-bold tracking-[-1px] sm:text-5xl", t.text)}>
              <Icon className="nia-pop size-9 sm:size-11" strokeWidth={2.25} aria-hidden style={{ animationDelay: "150ms" }} />
              {check.verdictWord}
            </span>
            {showPercent && (
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
          {sources.length > 0 && <SourceStack sources={sources} />}
        </div>
        {score !== null && <ScoreRing value={score} color={t.ring} label={scoreLabel} />}
      </header>

      <div className="grid gap-10 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* main column */}
        <div className="nia-rise min-w-0" style={{ animationDelay: "120ms" }}>
          <p className="text-[11px] font-semibold tracking-[3px] text-muted-foreground uppercase">
            {check.input === "link" ? "The article" : "The claim"}
          </p>
          <h3 className="mt-2 text-xl leading-snug font-bold tracking-[-0.02em] sm:text-2xl">{check.claim}</h3>

          {explanation && (
            <div className="mt-4 text-[15px] leading-relaxed text-foreground/85">
              <RichText text={explanation} />
            </div>
          )}

          {/* phones: the views as a row of chips above the panel */}
          {views.length > 0 && (
            <ViewChips
              views={views}
              defaultLabel={defaultLabel}
              active={active}
              loaded={loaded}
              onPick={(v) => void openView(v)}
            />
          )}

          <div ref={panel} className="mt-6 scroll-mt-24 lg:mt-8">
            {activeView ? (
              <ViewPanel
                key={activeView.id}
                view={activeView}
                state={loaded[activeView.id]}
                backLabel={defaultLabel}
                onBack={() => void openView(null)}
                onRetry={() => void openView(activeView)}
              />
            ) : correction ? (
              <WhatsTrue key="default" correction={correction} verdict={check.verdict} />
            ) : story ? (
              <section key="default" className="nia-rise rounded-[22px] border-l-4 border-[#3979ff] bg-muted/60 p-5 sm:p-6">
                <h4 className="text-[11px] font-semibold tracking-[3px] text-primary uppercase dark:text-[#6b9aff]">
                  What happened
                </h4>
                <div className="mt-3 text-[15px] leading-[1.75]">
                  <RichText text={story} />
                </div>
              </section>
            ) : null}
          </div>

          {claims.length > 0 && <ClaimBreakdown claims={claims} />}
        </div>

        {/* side column: other ways to see it, and the DailyMattr story */}
        <aside className="nia-rise min-w-0 space-y-8 lg:sticky lg:top-24 lg:self-start" style={{ animationDelay: "240ms" }}>
          {views.length > 0 && (
            <ViewMenu
              views={views}
              defaultLabel={defaultLabel}
              active={active}
              loaded={loaded}
              onPick={(v) => void openView(v)}
            />
          )}
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
        </aside>
      </div>

      {/* the sources, along the bottom */}
      <footer className="border-t bg-muted/30 p-6 sm:p-8">
        {sources.length > 0 && <Sources sources={sources} />}
        <p className={cn("text-xs leading-relaxed text-muted-foreground", sources.length > 0 && "mt-5")}>
          Checks are automated. Open the sources to confirm.
        </p>
      </footer>
    </article>
  );
}

/* ---------- see it another way ---------- */

type ViewState = { status: "loading" | "done" | "error"; text: string };

/** Each view's icon, by its question key ("q:<key>:<id>"). */
const VIEW_ICON: Record<string, typeof CircleCheck> = {
  sides: Scale,
  summary: RefreshCw,
  more: BookOpen,
  eli5: Baby,
  "five-ws": ListOrdered,
  "key-facts": Hash,
  timeline: Clock3,
  "why-matters": Lightbulb,
  "whats-next": FastForward,
  "why-fake": SearchX,
  "spot-fakes": ScanSearch,
  "why-unconfirmed": CircleHelp,
  explain: Newspaper,
  "real-story": BadgeCheck,
};
/** A view's icon (`id` null: the default view, NIA's own answer). */
function ViewIcon({ id, className }: { id: string | null; className?: string }) {
  const icon = id ? (VIEW_ICON[id.split(":")[1] ?? ""] ?? Sparkles) : BadgeCheck;
  return createElement(icon, { className, "aria-hidden": true });
}

type ViewPickerProps = {
  views: ChatQuestion[];
  defaultLabel: string | null;
  active: string | null;
  loaded: Record<string, ViewState>;
  onPick: (view: ChatQuestion | null) => void;
};

/** Desktop: the views as a list beside the panel. */
function ViewMenu({ views, defaultLabel, active, loaded, onPick }: ViewPickerProps) {
  const items = [
    ...(defaultLabel ? [{ id: null, title: defaultLabel, description: "NIA's answer" }] : []),
    ...views.map((v) => ({ id: v.id as string | null, title: v.title, description: v.description })),
  ];
  return (
    <nav aria-label="See this news another way" className="hidden lg:block">
      <p className="text-[11px] font-semibold tracking-[3px] text-muted-foreground uppercase">See it another way</p>
      <ul className="mt-3 space-y-1">
        {items.map((item) => {
          const view = views.find((v) => v.id === item.id) ?? null;
          const isActive = active === item.id;
          const state = item.id ? loaded[item.id]?.status : undefined;
          return (
            <li key={item.id ?? "default"}>
              <button
                type="button"
                onClick={() => onPick(view)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition-[background-color,border-color] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive ? "border-primary/40 bg-accent" : "border-transparent hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
                    isActive ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70 group-hover:bg-background",
                  )}
                >
                  <ViewIcon id={item.id} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-semibold", isActive && "text-accent-foreground")}>{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                </span>
                {state === "loading" && <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-label="Loading" />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Phones and tablets: the views as a scrolling row of chips. */
function ViewChips({ views, defaultLabel, active, loaded, onPick }: ViewPickerProps) {
  return (
    <div className="mt-6 lg:hidden">
      <p className="text-[11px] font-semibold tracking-[3px] text-muted-foreground uppercase">See it another way</p>
      <ul className="scrollbar-none -mx-6 mt-3 flex gap-2 overflow-x-auto px-6 pb-1 sm:-mx-8 sm:px-8">
        {defaultLabel && (
          <li className="shrink-0">
            <Chip active={active === null} onClick={() => onPick(null)} id={null} label={defaultLabel} />
          </li>
        )}
        {views.map((v) => (
          <li key={v.id} className="shrink-0">
            <Chip
              active={active === v.id}
              onClick={() => onPick(v)}
              id={v.id}
              label={v.title}
              loading={loaded[v.id]?.status === "loading"}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chip({
  active,
  onClick,
  id,
  label,
  loading,
}: {
  active: boolean;
  onClick: () => void;
  id: string | null;
  label: string;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40",
      )}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ViewIcon id={id} className="size-3.5" />}
      {label}
    </button>
  );
}

/** A picked view, written by NIA from this news's sources. */
function ViewPanel({
  view,
  state,
  backLabel,
  onBack,
  onRetry,
}: {
  view: ChatQuestion;
  state: ViewState | undefined;
  backLabel: string | null;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <section
      aria-live="polite"
      className="nia-rise overflow-hidden rounded-[22px] border border-primary/25 bg-accent/60"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-[11px] font-semibold tracking-[3px] text-primary uppercase dark:text-[#6b9aff]">
            <ViewIcon id={view.id} className="size-4" />
            {view.title}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">{view.description}</p>
        </div>
        {backLabel && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {backLabel}
          </button>
        )}
      </div>
      <div className="px-5 pt-4 pb-5 text-[15px] leading-[1.75] sm:px-6 sm:pb-6">
        {!state || state.status === "loading" ? (
          <div aria-label="NIA is writing">
            <div className="space-y-2.5">
              <div className="nia-skeleton h-3.5 w-11/12 rounded-full" />
              <div className="nia-skeleton h-3.5 w-4/5 rounded-full" />
              <div className="nia-skeleton h-3.5 w-full rounded-full" />
              <div className="nia-skeleton h-3.5 w-2/3 rounded-full" />
            </div>
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> NIA is writing this from the sources…
            </p>
          </div>
        ) : state.status === "error" ? (
          <div>
            <RichText text={state.text} />
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[background-color,transform] outline-none hover:bg-[var(--brand-blue-hover)] focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.98]"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="nia-rise">
            <RichText text={state.text} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------- what's actually true ---------- */

/** For news that isn't true: the real situation, its facts with their
 * sources, and what to do. Written from the sources only (lib/chat.ts). */
function WhatsTrue({ correction, verdict }: { correction: Correction; verdict: Verdict }) {
  const { headline, points, advice } = correction;
  const nothingKnown = !headline && points.length === 0;
  return (
    <section
      aria-labelledby="whats-true-title"
      className="nia-rise overflow-hidden rounded-[22px] border border-emerald-500/25 bg-emerald-500/[0.06]"
      style={{ animationDelay: "200ms" }}
    >
      <div className="p-5 sm:p-6">
        <h4
          id="whats-true-title"
          className="flex items-center gap-2 text-[11px] font-semibold tracking-[3px] text-emerald-700 uppercase dark:text-emerald-400"
        >
          <BadgeCheck className="size-4" aria-hidden />
          {verdict === "unverified" ? "What we know" : "What's actually true"}
        </h4>
        {headline && <p className="mt-3 text-lg leading-snug font-bold tracking-[-0.01em] sm:text-xl">{headline}</p>}
        {nothingKnown && (
          <p className="mt-3 text-[15px] leading-relaxed text-foreground/85">
            No trusted outlet or fact-checker reports this. Treat it as unconfirmed.
          </p>
        )}
        {points.length > 0 && (
          <ul className="mt-4 space-y-3">
            {points.map((p, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                <CircleCheck className="mt-[3px] size-[18px] shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <span className="min-w-0">
                  {p.text}
                  {p.source && (
                    <a
                      href={p.source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={p.source.title}
                      className="ml-2 inline-flex translate-y-[-1px] items-center gap-1.5 rounded-full border bg-card py-0.5 pr-2 pl-0.5 align-middle text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <OutletLogo url={p.source.url} name={p.source.source} className="size-[18px] rounded-full" />
                      {p.source.source}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {advice.length > 0 && (
        <div className="flex gap-3 border-t border-emerald-500/20 bg-emerald-500/[0.07] px-5 py-4 sm:px-6">
          <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
          <div className="min-w-0 text-[15px] leading-relaxed">
            <span className="font-semibold">What to do: </span>
            {advice.join(" ")}
          </div>
        </div>
      )}
    </section>
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
  // A false or partly true claim shows what the sources really say straight away.
  const [open, setOpen] = useState(claim.verdict === "contradicted" || claim.verdict === "partially-supported");
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
                <span className="min-w-0">
                  {claim.evidence}
                  {claim.source && (
                    <a
                      href={claim.source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={claim.source.title}
                      className="mt-2 flex w-fit max-w-full items-center gap-1.5 text-xs font-semibold text-primary hover:underline focus-visible:underline dark:text-[#6b9aff]"
                    >
                      <OutletLogo url={claim.source.url} name={claim.source.source} className="size-4 rounded-[5px]" />
                      <span className="shrink-0">{claim.source.source}</span>
                      {claim.source.title && (
                        <span className="truncate font-medium text-muted-foreground">· {claim.source.title}</span>
                      )}
                      <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </a>
                  )}
                </span>
              </blockquote>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/* ---------- sources ---------- */

const STACKED_LOGOS = 4;

/** Under the verdict, as on Perplexity: a few overlapping outlet logos and
 * "N sources". It jumps to the source cards at the bottom of the result. */
function SourceStack({ sources }: { sources: ChatCheck["sources"] }) {
  // One logo per outlet: fact-checkers first (they weigh most in the
  // verdict), then outlets with a real logo before letter-only ones.
  const rank = (s: ChatCheck["sources"][number]) =>
    (s.kind === "fact-check" ? 2 : 0) + (logoSite(s.url, s.source) ? 1 : 0);
  const outlets = [...sources]
    .sort((a, b) => rank(b) - rank(a))
    .filter((s, i, all) => all.findIndex((t) => t.source.toLowerCase() === s.source.toLowerCase()) === i)
    .slice(0, STACKED_LOGOS);
  const names = outlets.map((s) => s.source).join(", ");
  return (
    <a
      href="#nia-sources"
      onClick={(e) => {
        e.preventDefault();
        document.getElementById("nia-sources")?.scrollIntoView({ behavior: smooth(), block: "start" });
      }}
      title={`Checked against ${names}${sources.length > outlets.length ? " and more" : ""}`}
      className="group mt-4 inline-flex items-center gap-2.5 rounded-full border bg-background/60 py-1 pr-3.5 pl-1 backdrop-blur-sm transition-colors outline-none hover:border-foreground/25 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center">
        {outlets.map((s, i) => (
          <span
            key={s.url}
            className={cn("relative rounded-full ring-2 ring-card", i > 0 && "-ml-2")}
            style={{ zIndex: outlets.length - i }}
          >
            <OutletLogo url={s.url} name={s.source} className="size-6 rounded-full text-[13px]" />
          </span>
        ))}
      </span>
      <span className="text-[13px] font-semibold text-muted-foreground transition-colors group-hover:text-foreground">
        {sources.length} source{sources.length === 1 ? "" : "s"}
      </span>
    </a>
  );
}

const SHOWN_SOURCES = 6;

/** Every source NIA checked against, as cards along the bottom of the result. */
function Sources({ sources }: { sources: ChatCheck["sources"] }) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, SHOWN_SOURCES);
  return (
    <section id="nia-sources" aria-labelledby="sources-title" className="scroll-mt-24">
      <div className="flex items-end justify-between gap-3">
        <h4 id="sources-title" className="text-[11px] font-semibold tracking-[3px] text-muted-foreground uppercase">
          Sources NIA checked · {sources.length}
        </h4>
        {sources.length > SHOWN_SOURCES && (
          <button
            type="button"
            onClick={() => setAll((a) => !a)}
            className="text-[13px] font-semibold text-primary hover:underline focus-visible:underline dark:text-[#6b9aff]"
          >
            {all ? "Show fewer" : `Show all ${sources.length}`}
          </button>
        )}
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((s) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full items-start gap-3 rounded-[16px] border bg-card p-3.5 transition-[border-color,box-shadow,transform] duration-300 outline-none hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_12px_28px_-14px_rgb(10_10_11/0.3)] focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
            >
              <span className="relative shrink-0">
                <OutletLogo url={s.url} name={s.source} className="size-10 rounded-[11px] text-base" />
                {s.kind === "fact-check" && (
                  <span
                    className="absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-card"
                    title="Fact-checker"
                  >
                    <ShieldCheck className="size-2.5" aria-hidden />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-3 block text-[13.5px] leading-snug font-semibold group-hover:text-accent-foreground">
                  {s.title}
                </span>
                <span className="mt-1 block text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {s.source}
                  {s.kind === "fact-check" && " · Fact-check"}
                </span>
              </span>
              <ExternalLink
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- related PIX ---------- */

function Related({ items }: { items: RelatedPix[] }) {
  return (
    <section aria-labelledby="related-title" className="mx-auto mt-24 max-w-7xl scroll-mt-24 px-4 sm:px-8">
      <Reveal className="flex items-end gap-5">
        <div>
          <p className="text-[11px] font-semibold tracking-[3px] text-primary uppercase dark:text-[#6b9aff]">
            From DailyMattr
          </p>
          <h2 id="related-title" className="mt-2 text-2xl font-bold tracking-[-0.02em] sm:text-[32px]">
            Related stories we&apos;ve covered
          </h2>
        </div>
        <span className="mb-3 hidden h-px flex-1 bg-border sm:block" aria-hidden />
      </Reveal>
      {items.length === 0 ? (
        <div className="nia-rise mt-8 flex flex-col items-start gap-4 rounded-[24px] border border-dashed p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <p className="font-semibold">We haven&apos;t covered this story yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Catch up on today&apos;s other stories on DailyMattr.</p>
          </div>
          <a
            href="https://www.dailymattr.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-[transform,background-color] outline-none hover:-translate-y-px hover:bg-[var(--brand-blue-hover)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:hover:translate-y-0"
          >
            Latest stories <ArrowRight className="size-4" aria-hidden />
          </a>
        </div>
      ) : (
        !items.some((p) => p.close) && (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing on this exact story yet. These are on the same subject.
          </p>
        )
      )}
      <ul className="mt-8 grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
        {items.map((p, i) => (
          <Reveal as="li" key={p.id} delay={(i % 4) * 80}>
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col overflow-hidden rounded-[20px] border bg-card shadow-[0_1px_2px_rgb(10_10_11/0.04)] transition-[transform,box-shadow,border-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none hover:-translate-y-1 hover:shadow-[0_18px_36px_-12px_rgb(10_10_11/0.18)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:hover:translate-y-0"
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
          </Reveal>
        ))}
      </ul>
    </section>
  );
}
