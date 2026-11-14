import "server-only";
import { fetchArticle, looksLikeBoilerplate, type ClaimReview } from "./fetch-article";
import { findFactChecks, type FoundFactCheck } from "./fact-checks";
import { decideVerdict, type Verdict } from "./verdict";
import {
  extractClaims,
  factCheckArticle,
  factCheckEnabled,
  factCheckModel,
  MAX_SOURCE_CHARS,
  type ClaimVerdict,
  type FactCheckResult,
} from "./shortly/fact-check";
import {
  articleReader,
  findCoverageForClaims,
  findOutletsCovering,
  outletKey,
  passagesFor,
  searchQueriesFor,
  type FoundArticle,
  type SearchStats,
} from "./news-search";
import { findRelatedSources, significantTokens, type RelatedSource } from "./shortly/related-sources";

/** At least 2 significant words in common (Shortly's token rule). */
function sharesKeyWords(a: string, b: string): boolean {
  const bt = new Set(significantTokens(b));
  return significantTokens(a).filter((t) => bt.has(t)).length >= 2;
}

/** Other outlets (besides the original) to find, show and check against. */
const MAX_OTHER_OUTLETS = 10;

/** When the original can't be read, other outlets' full articles stand in for
 * it: this many outlets, this many characters each (fits MAX_SOURCE_CHARS). */
const FALLBACK_OUTLETS = 4;
const FALLBACK_CHARS = 2200;

/* Fact check for PIX (and pasted news). The checker in lib/shortly/fact-check.ts
 * began as Shortly-email-agent's and is now stricter (see that file):
 *
 *   STORY    = our story (PIX headline + text), so a wrong headline is caught
 *   SOURCE   = the original article's headline + body (fetched in full when the
 *              stored text is thin)
 *   CORROBORATION = up to 10 other outlets on the same story, from Shortly's
 *              scrape pool and Bing/Google News
 *
 * Claims are extracted from the story alone, then each is graded against the
 * evidence; claims still unconfirmed are searched for in the news one by one and
 * graded again. Score = average claim credit x (80 + 20 x source quality),
 * computed in code; a contradicted claim caps it at 45, and more than 1 in 10
 * claims found in no source caps it at 84. Labels: verified ≥85, mostly-factual ≥65,
 * mixed ≥40, unverified <40. */

export type { ClaimVerdict };
export type FactLabel = FactCheckResult["fact_label"];

export type NewsInput = {
  headline: string; // our headline
  summary: string; // our story text
  sourceTitle: string; // the original article's headline ("" if unknown)
  sourceText: string; // the original article's body ("" if unknown)
  sourceUrl?: string | null;
  storyUrl?: string | null; // where our story itself is published; its outlet is never used as evidence
  publishedAt?: string | null;
  pixId?: string | null;
  // Fact-checker ratings published on the story's own page (it is a fact-check).
  pageReviews?: ClaimReview[];
  // How to search fact-checkers (default: "<headline> fact check", ±3 days).
  factCheckSearch?: { windowDays?: number; extraQueries?: string[]; matchVariants?: boolean };
};

export type ReportSource = {
  source: string; // outlet name
  url: string;
  title: string;
  excerpt: string; // what that outlet reports (start of its article, or a search snippet)
  primary: boolean; // the article our story was written from
  match: "original" | "story" | "related"; // related = covers one event in our story
  published: string | null;
};

export type FactCheckReport = {
  headline: string;
  pixId: string | null;
  scored: boolean;
  score: number | null;
  label: FactLabel | null;
  rationale: string;
  claims: { claim: string; verdict: ClaimVerdict; evidence?: string }[]; // evidence = the source's own words
  signals: { attribution: number; specificity: number; tone: number } | null;
  sources: ReportSource[]; // primary first, then other outlets
  note: string | null; // how the evidence was gathered, or why it's unscored
  checked_at: string;
  model: string;
  method: string;
  duration_ms: number;
  search: { queries: string[]; fromShortly: number; fetched: number; matched: number } | null;
  // The plain answer: true, mostly true, partly false, false or unverified.
  verdict: Verdict;
  // Fact-checks of this story found by searching fact-checkers.
  factChecks: FoundFactCheck[];
  // When the checked page is itself a fact-check: the claims it rates.
  pageReviews: { claim: string; rating: string; by: string }[];
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
  "bbc.co.uk": "BBC",
  "aljazeera.com": "Al Jazeera",
  "dawn.com": "Dawn",
  "timesnownews.com": "Times Now",
  "wionews.com": "WION",
  "firstpost.com": "Firstpost",
  "abplive.com": "ABP Live",
  "freepressjournal.in": "Free Press Journal",
  "news.abplive.com": "ABP Live",
  "zeenews.india.com": "Zee News",
  "republicworld.com": "Republic World",
  "theprint.in": "ThePrint",
  "scroll.in": "Scroll",
  "thewire.in": "The Wire",
  "outlookindia.com": "Outlook",
  "dnaindia.com": "DNA",
  "tribuneindia.com": "The Tribune",
  "thequint.com": "The Quint",
  "cnbctv18.com": "CNBC-TV18",
  "businesstoday.in": "Business Today",
  "techcrunch.com": "TechCrunch",
  "apnews.com": "AP News",
  "theguardian.com": "The Guardian",
  "nytimes.com": "The New York Times",
  "cnn.com": "CNN",
  "bloomberg.com": "Bloomberg",
  "inc42.com": "Inc42",
};

const KNOWN_OUTLET_NAMES = new Set(Object.values(OUTLETS).map(outletKey));

/** A recognised news outlet (vs a blog, coaching site or aggregator), by its
 * site or, for Google News redirect links, by its name. */
function isKnownOutlet(url: string, name: string): boolean {
  if (KNOWN_OUTLET_NAMES.has(outletKey(name))) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
    return Boolean(OUTLETS[host] ?? OUTLETS[host.split(".").slice(-2).join(".")]);
  } catch {
    return false;
  }
}

/** The recognised news outlet whose own site `url` is on ("BBC" for
 * www.bbc.com/…), by the link's address alone; null for any other site. */
export function knownOutletOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    const labels = host.split(".");
    // The site itself, or a subdomain of it (news.bbc.co.uk → bbc.co.uk).
    for (let i = 0; i < labels.length - 1; i++) {
      const name = OUTLETS[labels.slice(i).join(".")];
      if (name) return name;
    }
    return null;
  } catch {
    return null;
  }
}

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

const unscored = (
  news: NewsInput,
  started: number,
  sources: ReportSource[],
  note: string,
  search: FactCheckReport["search"] = null,
): Omit<FactCheckReport, "verdict" | "factChecks" | "pageReviews"> => ({
  search,
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
  method: "source-grounding-v2",
  duration_ms: Date.now() - started,
});

export async function runFactCheck(news: NewsInput): Promise<FactCheckReport> {
  if (!factCheckEnabled()) throw new Error("Fact checking is turned off (FACT_CHECK_ENABLED=false).");
  if (!openaiConfigured()) throw new Error("OPENAI_API_KEY is not set in .env.");
  const apiKey = process.env.OPENAI_API_KEY!;
  const started = Date.now();
  const notes: string[] = [];

  // The story's claims don't depend on the evidence: extract them while the
  // evidence is gathered. (factCheckArticle awaits this and reports its error.)
  const story = `${news.headline}\n\n${news.summary}`.trim();
  const claims = extractClaims(apiKey, story);
  claims.catch(() => {});
  // Every article read during this check, each read once; full texts are kept
  // so the second look can quote the sentences about each unconfirmed claim.
  const read = articleReader();
  const fullTexts: { source: string; url: string; title: string; text: string }[] = [];

  // Has a fact-checker already checked this story? Runs alongside everything else.
  const factChecks = findFactChecks(
    apiKey,
    { headline: news.headline, text: news.summary, publishedAt: news.publishedAt },
    { read, excludeUrls: [news.storyUrl ?? ""], ...news.factCheckSearch },
  );
  const pageReviews = (news.pageReviews ?? []).map((r) => ({
    claim: r.claim,
    rating: r.rating,
    by: r.by ?? (news.storyUrl ? outletName(news.storyUrl) : "A fact-checker"),
  }));
  /** Adds the verdict (and the fact-checks behind it) to a finished report. */
  const finish = async (report: Omit<FactCheckReport, "verdict" | "factChecks" | "pageReviews">): Promise<FactCheckReport> => {
    const found = await factChecks;
    const verdict = decideVerdict({
      scored: report.scored,
      score: report.score,
      claims: report.claims,
      pageReviews,
      factChecks: found,
      outlets: report.sources.filter((s) => !s.primary).length,
    });
    return { ...report, verdict, factChecks: found, pageReviews, duration_ms: Date.now() - started };
  };

  // 1. Evidence base: the original article. Shortly fetches the full readable
  //    body when the stored text is thin (< 700 chars); a thin RSS-style
  //    snippet makes true claims look unsupported. fetchArticle retries
  //    transient failures so the evidence is the same from run to run.
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
      // Only trust a fetched headline that's about our story: blocked or odd
      // pages return titles like "Access Denied" or a social post's title.
      if (!sourceTitle && sharesKeyWords(article.title, news.headline)) sourceTitle = article.title;
    } catch {
      notes.push("The original article's link could not be opened.");
    }
  }

  const primary = news.sourceUrl ? { source: outletName(news.sourceUrl), url: news.sourceUrl } : null;
  // The checker reads the first MAX_SOURCE_CHARS of the original; the rest is
  // still searched for sentences about unconfirmed claims.
  if (primary && sourceText.length > MAX_SOURCE_CHARS) fullTexts.push({ ...primary, title: sourceTitle, text: sourceText });

  // 2. Other outlets that published the same story: Shortly's own feeds
  //    (best matches) plus Bing/Google News, one article per outlet.
  const storyTitle = sourceTitle || news.headline;
  // The story's own outlet can't confirm itself: exclude it along with the original.
  const storyOutlet = news.storyUrl ? outletName(news.storyUrl) : null;
  // Nor can DailyMattr, where PIX stories are published.
  const ownOutlets = [storyOutlet, "DailyMattr"].filter((o): o is string => Boolean(o));
  const excludeOutlets = [primary?.source, ...ownOutlets].filter((o): o is string => Boolean(o));
  const stats: SearchStats = { queries: [], fetched: 0, inWindow: 0, matched: 0 };
  const [fromShortly, fromNews] = await Promise.all([
    findRelatedSources(apiKey, {
      title: storyTitle,
      source: primary?.source ?? storyOutlet,
      url: news.sourceUrl ?? news.storyUrl ?? null,
      scrapedAt: news.publishedAt ?? null,
    }),
    // Search by the story's news events too, not just its headline.
    searchQueriesFor(apiKey, storyTitle, sourceText || news.summary).then((queries) =>
      findOutletsCovering(
        apiKey,
        { title: storyTitle, publishedAt: news.publishedAt, queries },
        { limit: MAX_OTHER_OUTLETS * 2, excludeOutlets, stats }, // spare candidates: some repeat Shortly's matches
      ),
    ),
  ]);
  const seenOutlets = new Set(excludeOutlets.map(outletKey));
  const seenHosts = new Set([news.sourceUrl, news.storyUrl].filter((u): u is string => Boolean(u)).map(hostOf));
  const related: (RelatedSource & { published?: string | null; match?: "story" | "related" })[] = [];
  // Shortly's curated feeds first, then news-search results: same-story before
  // related-event coverage, and recognised news outlets ahead of blogs and
  // aggregators within each group (stable otherwise, so best matches lead).
  const rank = (a: FoundArticle) => (a.match === "related" ? 2 : 0) + (isKnownOutlet(a.url, a.source) ? 0 : 1);
  const rankedNews = [...fromNews].sort((a, b) => rank(a) - rank(b));
  for (const r of [...fromShortly, ...rankedNews]) {
    const key = outletKey(r.source);
    // Google News links all share news.google.com, so they're de-duplicated
    // by outlet name only, never by host.
    const host = hostOf(r.url);
    const hostKey = /(^|\.)news\.google\.com$/.test(host) ? null : host;
    if (seenOutlets.has(key) || (hostKey && seenHosts.has(hostKey))) continue;
    seenOutlets.add(key);
    if (hostKey) seenHosts.add(hostKey);
    related.push(r);
    if (related.length >= MAX_OTHER_OUTLETS) break;
  }

  const searchInfo = { queries: stats.queries, fromShortly: fromShortly.length, fetched: stats.fetched, matched: stats.matched };

  const sources: ReportSource[] = [
    ...(primary
      ? [{ ...primary, title: sourceTitle, excerpt: sourceText.slice(0, 320), primary: true, match: "original" as const, published: news.publishedAt ?? null }]
      : []),
    ...related.map((r) => ({
      source: r.source,
      url: r.url,
      title: r.title,
      excerpt: r.excerpt,
      primary: false,
      match: r.match ?? ("story" as const),
      published: r.published ?? null,
    })),
  ];

  // 3. No readable original but other outlets covered it: grade against their
  //    coverage instead. Never grade against our own headline (circular).
  if ((sourceTitle + sourceText).trim().length < 40) {
    if (related.length === 0) {
      return finish(unscored(
        news,
        started,
        sources,
        news.sourceUrl
          ? "The original article couldn't be read and no other outlet that published this story was found, so there's nothing to check it against."
          : "No other outlet that published this story was found, so there's nothing to check it against.",
        searchInfo,
      ));
    }
    // Headlines and snippets alone are too thin (true claims look "not in
    // source"), so read the full articles of up to 4 outlets with direct links.
    const readable = related.filter((r) => !/(^|\.)news\.google\.com$/.test(hostOf(r.url))).slice(0, FALLBACK_OUTLETS);
    const bodies = await Promise.all(
      readable.map(async (r) => {
        const text = await read(r.url, 15_000);
        if (!text) return null;
        // The first FALLBACK_CHARS go to the checker; the whole article is kept
        // for the second look, since a fact can sit anywhere in it.
        fullTexts.push({ source: r.source, url: r.url, title: r.title, text });
        return { r, text: text.slice(0, FALLBACK_CHARS) };
      }),
    );
    const full = bodies.filter((b): b is NonNullable<typeof b> => b !== null);
    const fullUrls = new Set(full.map((b) => b.r.url));
    sourceTitle = (full[0]?.r ?? related[0]).title;
    // Full bodies first: the checker reads the first MAX_SOURCE_CHARS characters.
    sourceText = [
      ...full.map((b) => `[${b.r.source}] ${b.r.title}\n${b.text}`),
      ...related.filter((r) => !fullUrls.has(r.url)).map((r) => `[${r.source}] ${r.title}. ${r.excerpt}`),
    ].join("\n\n");
    const why = news.sourceUrl ? " because the original article couldn't be read" : "";
    notes.push(
      full.length
        ? `Checked against the full articles of ${full.length} other outlet${full.length === 1 ? "" : "s"}${why}, plus the rest of the coverage.`
        : `Checked against other outlets' headlines and snippets${why}.`,
    );
  }

  // 4. Shortly's fact check.
  const result = await factCheckArticle(
    apiKey,
    {
      title: sourceTitle,
      summary: story,
      claims,
      sourceText,
      primarySource: primary,
      relatedSources: related,
      // For claims the first pass couldn't confirm: the sentences about them in
      // every article already read, plus coverage found by searching for each claim.
      moreEvidence: async (open) => {
        // Until now the other outlets are known by headline and snippet only:
        // read the ones with direct links (Google News links can't be read).
        const unread = related.filter(
          (r) => !/(^|\.)news\.google\.com$/.test(hostOf(r.url)) && !fullTexts.some((d) => d.url === r.url),
        );
        const [, searched] = await Promise.all([
          Promise.all(
            unread.map(async (r) => {
              const text = await read(r.url, 8_000);
              if (text) fullTexts.push({ source: r.source, url: r.url, title: r.title, text });
            }),
          ),
          findCoverageForClaims(open, { publishedAt: news.publishedAt, excludeOutlets: ownOutlets, read }),
        ]);
        const fromRead = fullTexts.flatMap((d) => {
          const excerpt = passagesFor(d.text, open);
          return excerpt ? [{ source: d.source, url: d.url, title: d.title, excerpt }] : [];
        });
        const seen = new Set(fromRead.map((d) => d.url));
        return [...fromRead, ...searched.filter((s) => !seen.has(s.url))];
      },
    },
    { throwOnError: true },
  );
  if (!result) {
    return finish(unscored(news, started, sources, "No checkable factual claims were found in the story, or there was too little source text to check them against.", searchInfo));
  }

  return finish({
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
    search: searchInfo,
  });
}
