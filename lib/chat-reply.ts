import { CHECK_FAILED, WELCOME_TEXT, type ChatButton, type ChatCheck, type ChatMessage, type ChatReply } from "./chat-text";
import type { FactCheckReport } from "./factcheck";
import type { NewsCheckResult } from "./news-check";
import { dailyMattrUrl, type PixPostSummary } from "./pix";
import type { PixMatch, TextCheckResult } from "./text-check";
import type { VerdictLabel } from "./verdict";

export { CHECK_FAILED };
export type { ChatButton, ChatCheck, ChatMessage, ChatReply };

/* The bot's (NIA's) replies, built from a check result, in the style of the
 * WhatsApp demo. Text uses WhatsApp formatting: *bold*, _italic_. A checked
 * message gets two messages:
 *   1. the verdict with its percentage ("❌ *FALSE* · 100% fake"), what is
 *      actually true, and what to do; sent as a reply to the reader's message;
 *   2. what's actually happening, with "Read: …" link buttons.
 * Nothing here calls a model: the wording comes from the check itself. */

const WORD: Record<VerdictLabel, string> = {
  true: "True",
  "mostly-true": "Mostly true",
  "partly-false": "Partly false",
  false: "False",
  unverified: "Unverified",
};

const VERDICT_ICON: Record<VerdictLabel, string> = {
  false: "❌",
  "partly-false": "⚠️",
  unverified: "❓",
  "mostly-true": "✅",
  true: "✅",
};

const TOPIC_EMOJI: Record<string, string> = {
  finance: "💰",
  business: "📈",
  politics: "🏛️",
  health: "🩺",
  technology: "💻",
  sports: "🏏",
  world: "🌍",
  science: "🔬",
  entertainment: "🎬",
  education: "🎓",
  crime: "🚨",
  weather: "🌦️",
};

const MAX_BUTTONS = 3;

/* ---------- the verdict and its percentage ---------- */

const isFake = (l: VerdictLabel) => l === "false" || l === "partly-false";
const isConfirmed = (l: VerdictLabel) => l === "true" || l === "mostly-true";

/** The percentage that goes with the verdict, from the claim-by-claim check:
 * fake verdicts show the share of claims that are false or reported nowhere,
 * true verdicts the share confirmed by trusted sources, unverified the share
 * that could be confirmed. */
function percentOf(label: VerdictLabel, claims: FactCheckReport["claims"]): Pick<ChatCheck, "percent" | "percentOf"> {
  const n = claims.length;
  if (n === 0) return { percent: null, percentOf: null };
  const fake = claims.filter((c) => c.verdict === "contradicted" || c.verdict === "unsupported").length;
  const confirmed = claims.filter((c) => c.verdict === "supported" || c.verdict === "partially-supported").length;
  if (isFake(label)) return { percent: Math.round((100 * fake) / n), percentOf: "fake" };
  if (isConfirmed(label)) return { percent: Math.round((100 * confirmed) / n), percentOf: "true" };
  return { percent: Math.round((100 * confirmed) / n), percentOf: "confirmed" };
}

/** "❌ *FALSE* · 100% fake". When a fact-checker settled it and few claims
 * were found false, say who instead of a percentage that would look odd. */
function verdictLine(label: VerdictLabel, pct: Pick<ChatCheck, "percent" | "percentOf">, debunkedBy: string | null) {
  const head = `${VERDICT_ICON[label]} *${WORD[label].toUpperCase()}*`;
  if (debunkedBy && isFake(label) && (pct.percent ?? 0) < 50) return `${head} · debunked by ${debunkedBy}`;
  if (pct.percent === null) return head;
  return `${head} · *${pct.percent}% ${pct.percentOf}*`;
}

/** The fact-checker that found it false or misleading, if one did. */
function debunker(report: FactCheckReport): { by: string; rating: string } | null {
  if (report.verdict.basis !== "fact-check" && report.verdict.basis !== "fact-check-page") return null;
  const fc = report.factChecks.find((f) => f.storyIs === "false" || f.storyIs === "misleading");
  if (fc) return { by: fc.by, rating: fc.rating };
  const page = report.pageReviews[0];
  return page ? { by: page.by, rating: page.rating } : null;
}

/* ---------- small helpers ---------- */

/** "Read: <label>" within WhatsApp's 20-character button: the first candidate
 * that fits whole (e.g. "PIB fact check", then the outlet's name), else the
 * first one cut at a word. */
function readLabel(...candidates: (string | null | undefined)[]): string {
  const room = 20 - "Read: ".length;
  const clean = candidates.map((c) => (c ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const whole = clean.find((c) => c.length <= room);
  if (whole) return `Read: ${whole}`;
  const first = clean[0] ?? "source";
  const cut = first.slice(0, room - 1).replace(/\s+\S*$/, "");
  return `Read: ${cut || first.slice(0, room - 1)}…`;
}

const SMALL_WORDS = new Set(
  "a an the of to in on for and or but at by as from with after before over into is are was were be has have had its it this that how why what who when says said".split(
    " ",
  ),
);

/** A headline's key words for a button, whole words only: "From a ₹20,000
 * loan to Airtel…" → "Read: ₹20,000 loan". */
function headlineLabel(headline: string): string {
  const room = 20 - "Read: ".length;
  const words = headline
    .replace(/[“”"‘’:;!?()[\]]|,(?!\d)/g, " ") // keeps "₹20,000"
    .split(/\s+/)
    .filter((w) => w && !SMALL_WORDS.has(w.toLowerCase()));
  let label = "";
  for (const w of words) {
    const next = label ? `${label} ${w}` : w;
    if (next.length > room) break;
    label = next;
  }
  return label ? `Read: ${label}` : readLabel(headline);
}

/** An outlet's name for a button: a bare domain loses its ending
 * ("lapaasvoice.com" → "lapaasvoice"); a real name ("India.com") is kept. */
const shortSource = (source: string) =>
  source === source.toLowerCase()
    ? source.replace(/^www\./, "").replace(/\.(com|in|org|net|co\.in|co\.uk|news|info)$/, "")
    : source;

const isPublicUrl = (u: string) => /^https?:\/\//i.test(u);

function message(text: string, buttons: ChatButton[] = [], replyTo?: string): ChatMessage {
  const m: ChatMessage = { text: text.trim() };
  if (replyTo) m.replyTo = replyTo;
  const list = buttons.filter((b) => isPublicUrl(b.url)).slice(0, MAX_BUTTONS);
  if (list.length) {
    m.buttons = list;
    m.plainText = `${m.text}\n\n${list.map((b) => `🔗 ${b.label}\n${b.url}`).join("\n\n")}`;
  }
  return m;
}

/** The start of a story, cut at a sentence (or word) near `n` characters. */
function excerptOf(text: string, n = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  // PIX stories are bullet points: keep the first two, one per line.
  const bullets = clean.split(/\s*•\s*/).filter(Boolean);
  if (bullets.length > 1) return bullets.slice(0, 2).map((b) => `• ${b}`).join("\n");
  if (clean.length <= n) return clean;
  const cut = clean.slice(0, n);
  const sentence = cut.lastIndexOf(". ");
  return sentence > n * 0.5 ? cut.slice(0, sentence + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
}

/** The DailyMattr post on this news, on its own: its photo, headline, the
 * start of the story and a "Read on DailyMattr" button. */
function dailyMattrCard(p: PixMatch, intro: string): ChatMessage {
  const excerpt = excerptOf(p.excerpt);
  const m = message(`${intro}\n\n*${p.headline}*${excerpt ? `\n\n${excerpt}` : ""}`, [
    { label: "Read on DailyMattr", url: dailyMattrUrl(p)! },
  ]);
  if (p.image && isPublicUrl(p.image)) m.image = p.image;
  return m;
}

/** The DailyMattr post to lead with: the closest same-story match. */
const leadStory = (pix: PixMatch[]) => pix.find((p) => p.sameStory && dailyMattrUrl(p) !== null);

const dailyMattrInfo = (p: PixMatch | undefined): ChatCheck["dailyMattr"] =>
  p ? { title: p.headline, url: dailyMattrUrl(p)!, image: p.image } : null;

const LEAD_INTRO: Record<VerdictLabel, string> = {
  true: "📲 *Read the full story on DailyMattr* 👇",
  "mostly-true": "📲 *Read the full story on DailyMattr* 👇",
  false: "📲 *Here's the real story on DailyMattr* 👇",
  "partly-false": "📲 *Here's the real story on DailyMattr* 👇",
  unverified: "📲 *DailyMattr on this news* 👇",
};

/** One line per story: the same headline from two outlets is shown once. */
const sameTitle = (a: string, b: string) =>
  a.toLowerCase().replace(/\W+/g, " ").trim() === b.toLowerCase().replace(/\W+/g, " ").trim();

/* ---------- fixed replies ---------- */

export function welcomeReply(): ChatReply {
  return { kind: "welcome", messages: [message(WELCOME_TEXT)] };
}

export function notNewsReply(replyTo?: string): ChatReply {
  return {
    kind: "not-news",
    messages: [
      message(
        "🤔 I couldn't find any news in that to check.\n\nForward me a message that says something *happened*, or send a news link, and I'll tell you if it's true or false.",
        [],
        replyTo,
      ),
    ],
  };
}

export function unsupportedReply(type: string, replyTo?: string): ChatReply {
  const text =
    type === "image"
      ? "📷 Checking photos is *coming soon*!\n\nFor now, send me the text of the forward, or a news link."
      : "I can check *text messages* and *news links* for now.\n\nSend me the text of the forward, or a news link.";
  return { kind: "unsupported", messages: [message(text, [], replyTo)] };
}

export function errorReply(text: string, replyTo?: string): ChatReply {
  return { kind: "error", messages: [message(text, [], replyTo)] };
}

export const UNREADABLE_LINK =
  "😕 I couldn't open a news article at that link.\n\nSend the article's own page (not a home page or live blog), or paste the message text instead.";

export const TOO_LONG = "That's a long one! 😅 Send me one message of up to 5,000 characters.";

/* ---------- a checked message ---------- */

const OPENING: Record<VerdictLabel, { title: string; lead: string }> = {
  false: { title: "🎯 *Hey, you've spotted fake news!*", lead: "This forward is *not real*." },
  "partly-false": { title: "⚠️ *Careful: parts of this are fake*", lead: "Some of what this forward says is *wrong*." },
  unverified: { title: "🤔 *I couldn't confirm this*", lead: "No trusted source reports this, so *don't trust it yet*." },
  "mostly-true": { title: "👍 *This one is mostly real*", lead: "Most of it *matches trusted reports*." },
  true: { title: "👍 *Good news: this one is real!*", lead: "Trusted sources *report the same thing*." },
};

export function messageCheckReply(result: TextCheckResult, replyTo?: string): ChatReply {
  const { report, realNews, links, pix, scores } = result;
  const label = report.verdict.label;
  const confirmed = isConfirmed(label);
  const open = OPENING[label];
  const pct = percentOf(label, report.claims);
  const fc = debunker(report);

  // 1. The verdict: "❌ FALSE · 100% fake", what's true, and one thing to do.
  const said = fc
    ? `*${fc.by}* has fact-checked this${fc.rating ? ` and rated it “${fc.rating}”` : ""}.`
    : realNews?.headline
      ? ""
      : report.verdict.reason;
  const para = [open.lead, realNews?.headline, said].filter(Boolean).join(" ");
  const advice = confirmed
    ? `👍 ${label === "true" ? "It's safe to share." : "It's mostly safe to share."}`
    : realNews?.advice[0]
      ? `✅ ${realNews.advice[0]}`
      : "";
  const first = [verdictLine(label, pct, fc?.by ?? null), open.title, para, advice].filter(Boolean).join("\n\n");
  const messages = [message(first, [], replyTo)];

  // 2. DailyMattr first: when a DailyMattr post covers this same news, it gets
  //    a message of its own (photo, headline, story, button).
  const lead = leadStory(pix);
  if (lead) messages.push(dailyMattrCard(lead, LEAD_INTRO[label]));

  // 3. Then the rest, each a headline with a "Read: …" button.
  //    True news: this story's own coverage (other DailyMattr posts on it, then
  //    other outlets), nothing else. Fake or unconfirmed: only the DailyMattr
  //    stories about that exact thing (lib/chat.ts filters them), or nothing.
  const topic = result.topic && result.topic !== "news" ? result.topic : null;
  const emoji = (topic && TOPIC_EMOJI[topic]) || "📰";
  const asStory = (p: PixPostSummary) => ({
    line: `${emoji} *${p.headline}*`,
    title: p.headline,
    label: headlineLabel(p.headline),
    url: dailyMattrUrl(p),
  });
  const others = pix.filter((p) => p.id !== lead?.id);
  const ranked = [...others].sort((a, b) => Number(b.sameStory) - Number(a.sameStory));
  const candidates = confirmed
    ? [
        ...others.filter((p) => p.sameStory).map(asStory),
        ...links
          .filter((l) => l.kind !== "dailymattr")
          .map((l) => ({
            line: `📰 *${l.title}* · ${l.source}`,
            title: l.title,
            label: readLabel(shortSource(l.source)),
            url: l.url,
          })),
      ]
    : ranked.map(asStory);
  const shown = candidates
    .filter((s): s is typeof s & { url: string } => s.url !== null)
    .filter((s) => !lead || !sameTitle(s.title, lead.headline))
    .filter((s, i, all) => all.findIndex((t) => t.url === s.url || sameTitle(t.title, s.title)) === i)
    .slice(0, MAX_BUTTONS);
  if (shown.length) {
    const intro = confirmed
      ? lead
        ? "Also reported by 👇"
        : "Here's the full story 👇"
      : lead
        ? "More on this 👇"
        : "Here's what's *actually* happening 👇";
    messages.push(
      message(
        `${intro}\n\n${shown.map((s) => s.line).join("\n\n")}`,
        shown.map((s) => ({ label: s.label, url: s.url })),
      ),
    );
  }

  return {
    kind: "check",
    messages,
    check: {
      input: "message",
      verdict: label,
      verdictWord: WORD[label],
      ...pct,
      reason: report.verdict.reason,
      claim: result.claim,
      topic: result.topic ?? null,
      fakeCaught: isFake(label),
      factScore: scores.factScore,
      fakePercent: scores.fakePercent,
      sources: links.map((l) => {
        const p = l.kind === "dailymattr" ? pix.find((x) => l.url === `/pix/${x.id}`) : null;
        return { title: l.title, source: l.source, url: (p && dailyMattrUrl(p)) || l.url, kind: l.kind };
      }),
      dailyMattr: dailyMattrInfo(lead),
      checkedAt: report.checked_at,
      cached: Boolean(result.cached),
    },
  };
}

/* ---------- a checked news link ---------- */

const LINK_OPENING: Record<VerdictLabel, { title: string; advice: string }> = {
  false: { title: "🎯 *Hey, you've spotted fake news!*", advice: "✅ Don't forward it." },
  "partly-false": { title: "⚠️ *Careful: parts of this story are wrong*", advice: "✅ Don't forward it as it is." },
  unverified: {
    title: "🤔 *I couldn't confirm this story*",
    advice: "✅ Wait until a trusted outlet reports it before you share it.",
  },
  "mostly-true": { title: "👍 *This story is mostly real*", advice: "👍 It's mostly safe to share." },
  true: { title: "👍 *Good news: this story is real!*", advice: "👍 It's safe to share." },
};

/** `pix`: DailyMattr posts on the same news as the article (for a DailyMattr
 * link, its own post); the reply leads with the closest one. */
export function linkCheckReply(report: NewsCheckResult, replyTo?: string, pix: PixMatch[] = []): ChatReply {
  const label = report.verdict.label;
  const pct = percentOf(label, report.claims);
  const fc = debunker(report);
  // A genuine article on a recognised outlet's own site that no one else has
  // covered yet (lib/news-check.ts): real news, but not cross-checked.
  const publisher = report.verdict.basis === "trusted-outlet" ? (report.verdict.publisher ?? "a trusted outlet") : null;
  const open = publisher
    ? {
        title: `👍 *This is real news from ${publisher}*`,
        advice: `👍 It's safe to share. The details are ${publisher}'s own reporting.`,
      }
    : LINK_OPENING[label];
  const head = publisher ? `✅ *REAL NEWS* · from *${publisher}*` : verdictLine(label, pct, fc?.by ?? null);
  const messages = [
    message([head, open.title, `📰 _${report.headline}_`, report.verdict.reason, open.advice].join("\n\n"), [], replyTo),
  ];

  // 2. DailyMattr first, on its own, when it has this news.
  const lead = leadStory(pix);
  if (lead) messages.push(dailyMattrCard(lead, LEAD_INTRO[label]));

  // 3. Then the rest: fact-checkers, other outlets, other DailyMattr posts.
  const sources = [
    ...report.factChecks
      .filter((f) => f.storyIs !== "unclear")
      .map((f) => ({ title: f.title, source: f.by, url: f.url, kind: "fact-check" as const })),
    ...report.sources
      .filter((s) => !s.primary)
      .map((s) => ({ title: s.title || s.source, source: s.source, url: s.url, kind: "outlet" as const })),
    ...pix
      .filter((p) => p.id !== lead?.id && dailyMattrUrl(p))
      .map((p) => ({ title: p.headline, source: "DailyMattr", url: dailyMattrUrl(p)!, kind: "dailymattr" as const })),
  ].filter((s, i, all) => all.findIndex((t) => t.url === s.url) === i);
  const shown = sources
    .filter((s) => !lead || !sameTitle(s.title, lead.headline))
    .filter((s, i, all) => all.findIndex((t) => sameTitle(t.title, s.title)) === i)
    .slice(0, MAX_BUTTONS);
  if (shown.length) {
    const intro = isConfirmed(label) || publisher ? "Also reported by" : "Here's what other sources say";
    messages.push(
      message(
        `${intro} 👇\n\n${shown.map((s) => `📰 *${s.title}* · ${s.source}`).join("\n\n")}`,
        shown.map((s) => ({
          label: s.kind === "dailymattr" ? headlineLabel(s.title) : readLabel(shortSource(s.source)),
          url: s.url,
        })),
      ),
    );
  }

  return {
    kind: "check",
    messages,
    check: {
      input: "link",
      verdict: label,
      verdictWord: WORD[label],
      ...pct,
      reason: report.verdict.reason,
      claim: report.headline,
      topic: null,
      fakeCaught: isFake(label),
      factScore: report.scored ? report.score : null,
      fakePercent: report.claims.length
        ? Math.round(
            (100 * report.claims.filter((c) => c.verdict === "contradicted" || c.verdict === "unsupported").length) /
              report.claims.length,
          )
        : null,
      sources: [
        ...(lead ? [{ title: lead.headline, source: "DailyMattr", url: dailyMattrUrl(lead)!, kind: "dailymattr" as const }] : []),
        ...sources,
      ],
      dailyMattr: dailyMattrInfo(lead),
      checkedAt: report.checked_at,
      cached: Boolean(report.cached),
    },
  };
}
