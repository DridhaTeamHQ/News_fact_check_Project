import "server-only";
import { fetchArticle, looksLikeBoilerplate } from "./fetch-article";
import {
  factCheckArticle,
  factCheckEnabled,
  factCheckModel,
  type ClaimVerdict,
  type FactCheckResult,
} from "./shortly/fact-check";
import { findOutletsCovering, outletKey } from "./news-search";
import { findRelatedSources, type RelatedSource } from "./shortly/related-sources";

/** Other outlets (besides the original) to find, show and check against. */
const MAX_OTHER_OUTLETS = 10;

/* Fact check for PIX (and pasted news), using Shortly-email-agent's own
 * fact-check code in lib/shortly/ — the same prompt, model (gpt-4o-mini) and
 * scoring as the Shortly newsletter:
 *
 *   SUMMARY  = our story (PIX headline + text), so a wrong headline is caught
 *   SOURCE   = the original article's headline + body (Shortly fetches the full
 *              readable body when the stored text is thin; so do we)
 *   CORROBORATION = up to 4 other outlets on the same story from Shortly's
 *              scrape pool (embedding match, token-overlap fallback)
 *
 * Score = 70% claim grounding + 30% credibility signals, computed in code; a
 * contradicted claim caps it at 45. Labels: verified ≥85, mostly-factual ≥65,
 * mixed ≥40, unverified <40. */

export type { ClaimVerdict };
export type FactLabel = FactCheckResult["fact_label"];

export type NewsInput = {
  headline: string; // our headline
  summary: string; // our story text
  sourceTitle: string; // the original article's headline ("" if unknown)
  sourceText: string; // the original article's body ("" if unknown)
  sourceUrl?: string | null;
  publishedAt?: string | null;
  pixId?: string | null;
};

export type ReportSource = {
  source: string; // outlet name
  url: string;
  title: string;
  excerpt: string; // what that outlet reports (start of its article, or a search snippet)
  primary: boolean; // the article our story was written from
  published: string | null;
};

export type FactCheckReport = {
  headline: string;
  pixId: string | null;
  scored: boolean;
  score: number | null;
  label: FactLabel | null;
  rationale: string;
  claims: { claim: string; verdict: ClaimVerdict }[];
  signals: { attribution: number; specificity: number; tone: number } | null;
  sources: ReportSource[]; // primary first, then other outlets
  note: string | null; // how the evidence was gathered, or why it's unscored
  checked_at: string;
  model: string;
  method: string;
  duration_ms: number;
};

export const openaiConfigured = () => Boolean(process.env.OPENAI_API_KEY);

const OUTLETS: Record<string, string> = {
  "timesofindia.indiatimes.com": "Times of India",
  "economictimes.indiatimes.com": "Economic Times",
  "hindustantimes.com": "Hindustan Times",
  "indianexpress.com": "Indian Express",
  "thehindu.com": "The Hindu",
  "ndtv.com": "NDTV",
  "sports.ndtv.com": "NDTV Sports",
  "ndtvprofit.com": "NDTV Profit",
  "news18.com": "News18",
  "moneycontrol.com": "Moneycontrol",
  "livemint.com": "Mint",
  "business-standard.com": "Business Standard",
  "newindianexpress.com": "New Indian Express",
  "telegraphindia.com": "The Telegraph",
  "deccanherald.com": "Deccan Herald",
  "thehindubusinessline.com": "BusinessLine",
  "financialexpress.com": "Financial Express",
  "indiatoday.in": "India Today",
  "reuters.com": "Reuters",
  "bbc.com": "BBC",
  "aljazeera.com": "Al Jazeera",
  "dawn.com": "Dawn",
};

export function outletName(url: string): string {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    return "Source";
  }
  return OUTLETS[host] ?? OUTLETS[host.split(".").slice(-2).join(".")] ?? host;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const unscored = (news: NewsInput, started: number, sources: ReportSource[], note: string): FactCheckReport => ({
  headline: news.headline,
  pixId: news.pixId ?? null,
  scored: false,
  score: null,
  label: null,
  rationale: "",
  claims: [],
  signals: null,
  sources,
  note,
  checked_at: new Date().toISOString(),
  model: factCheckModel(),
  method: "source-grounding-v1",
  duration_ms: Date.now() - started,
});

export async function runFactCheck(news: NewsInput): Promise<FactCheckReport> {
  if (!factCheckEnabled()) throw new Error("Fact checking is turned off (FACT_CHECK_ENABLED=false).");
  if (!openaiConfigured()) throw new Error("OPENAI_API_KEY is not set in .env.");
  const apiKey = process.env.OPENAI_API_KEY!;
  const started = Date.now();
  const notes: string[] = [];

  // 1. Evidence base: the original article. Shortly fetches the full readable
  //    body when the stored text is thin (< 700 chars); a thin RSS-style
  //    snippet makes true claims look unsupported.
  let sourceTitle = news.sourceTitle.trim();
  let sourceText = news.sourceText.trim();
  // Stored scrape text is sometimes page furniture (cookie notices, widgets).
  if (sourceText && looksLikeBoilerplate(sourceText)) sourceText = "";
  if (sourceText.length < 700 && news.sourceUrl) {
    try {
      const article = await fetchArticle(news.sourceUrl);
      if (article.text.length > sourceText.length && !looksLikeBoilerplate(article.text)) {
        sourceText = article.text;
        notes.push("Read the full original article from its link.");
      }
      if (!sourceTitle) sourceTitle = article.title;
    } catch {
      notes.push("The original article's link could not be opened.");
    }
  }

  const primary = news.sourceUrl ? { source: outletName(news.sourceUrl), url: news.sourceUrl } : null;

  // 2. Other outlets that published the same story: Shortly's own feeds
  //    (best matches) plus Bing/Google News, one article per outlet.
  const storyTitle = sourceTitle || news.headline;
  const [fromShortly, fromNews] = await Promise.all([
    findRelatedSources(apiKey, {
      title: storyTitle,
      source: primary?.source ?? null,
      url: news.sourceUrl ?? null,
      scrapedAt: news.publishedAt ?? null,
    }),
    findOutletsCovering(
      apiKey,
      { title: storyTitle, publishedAt: news.publishedAt },
      { limit: MAX_OTHER_OUTLETS, excludeOutlets: primary ? [primary.source] : [] },
    ),
  ]);
  const seenOutlets = new Set(primary ? [outletKey(primary.source)] : []);
  const seenHosts = new Set(news.sourceUrl ? [hostOf(news.sourceUrl)] : []);
  const related: (RelatedSource & { published?: string | null })[] = [];
  for (const r of [...fromShortly, ...fromNews]) {
    const key = outletKey(r.source);
    if (seenOutlets.has(key) || seenHosts.has(hostOf(r.url))) continue;
    seenOutlets.add(key);
    seenHosts.add(hostOf(r.url));
    related.push(r);
    if (related.length >= MAX_OTHER_OUTLETS) break;
  }

  const sources: ReportSource[] = [
    ...(primary
      ? [{ ...primary, title: sourceTitle, excerpt: sourceText.slice(0, 320), primary: true, published: news.publishedAt ?? null }]
      : []),
    ...related.map((r) => ({
      source: r.source,
      url: r.url,
      title: r.title,
      excerpt: r.excerpt,
      primary: false,
      published: r.published ?? null,
    })),
  ];

  // 3. No readable original but other outlets covered it: grade against their
  //    coverage instead. Never grade against our own headline (circular).
  if ((sourceTitle + sourceText).trim().length < 40) {
    if (related.length === 0) {
      return unscored(
        news,
        started,
        sources,
        news.sourceUrl
          ? "The original article couldn't be read and no other outlet in Shortly's feeds covered this story, so there's nothing to check it against."
          : "No original source link, and no other outlet in Shortly's feeds covered this story, so there's nothing to check it against.",
      );
    }
    sourceTitle = related[0].title;
    sourceText = related.map((r) => `[${r.source}] ${r.title}. ${r.excerpt}`).join("\n\n");
    notes.push("Checked against other outlets' coverage because the original article couldn't be read.");
  }

  // 4. Shortly's fact check.
  const result = await factCheckArticle(
    apiKey,
    {
      title: sourceTitle,
      summary: `${news.headline}\n\n${news.summary}`.trim(),
      sourceText,
      primarySource: primary,
      relatedSources: related,
    },
    { throwOnError: true },
  );
  if (!result) {
    return unscored(news, started, sources, "Not enough story or source text to check.");
  }

  return {
    headline: news.headline,
    pixId: news.pixId ?? null,
    scored: true,
    score: result.fact_score,
    label: result.fact_label,
    rationale: result.fact_notes.rationale,
    claims: result.fact_notes.claims,
    signals: result.fact_notes.signals,
    sources,
    note: notes.join(" ") || null,
    checked_at: new Date().toISOString(),
    model: factCheckModel(),
    method: result.fact_notes.method,
    duration_ms: Date.now() - started,
  };
}
