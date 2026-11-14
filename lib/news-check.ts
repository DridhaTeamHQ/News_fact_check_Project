import "server-only";
import { getCachedCheck, setCachedCheck } from "./check-cache";
import { knownOutletOf, runFactCheck, type FactCheckReport, type NewsInput } from "./factcheck";
import { fetchArticle, isHttpUrl, looksLikeBoilerplate } from "./fetch-article";
import { getPixPost, getPixPostByPublishedId, publishedIdFromDailyMattrUrl, type PixPost } from "./pix";

/* Checking one news story: a PIX (by id) or a news link. A DailyMattr news
 * link is a PIX and is checked the same way as on its PIX page; any other
 * link is read, and other outlets that published the same news are the
 * evidence. Used by /api/check (the web pages) and /api/v1/chat (WhatsApp).
 *
 * PIX checks are kept in memory for 6 hours (lib/check-cache.ts); `force`
 * checks again. */

/** `articleText`: the checked story's own text (for the chat's follow-up
 * questions); /api/check leaves it out of its response. */
export type NewsCheckResult = FactCheckReport & { cached?: boolean; articleText?: string };

/** A problem with the request (bad link, unreadable article): `status` is the
 * HTTP status to answer with, `message` is safe to show the reader. */
export class NewsCheckError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const fromPix = (post: PixPost): NewsInput => ({
  headline: post.headline,
  summary: post.body,
  sourceTitle: post.source_title,
  sourceText: post.source_text,
  sourceUrl: post.source_url,
  publishedAt: post.published_at,
  pixId: post.id,
});

export async function checkNews(input: { pixId?: string; url?: string; force?: boolean }): Promise<NewsCheckResult> {
  let post: PixPost | null = null;
  const url = (input.url ?? "").trim();

  if (input.pixId) {
    post = await getPixPost(input.pixId);
    if (!post) throw new NewsCheckError("PIX post not found.", 404);
  } else if (url) {
    if (!isHttpUrl(url)) throw new NewsCheckError("Paste a full link starting with http:// or https://", 400);
    const publishedId = publishedIdFromDailyMattrUrl(url);
    if (publishedId) {
      post = await getPixPostByPublishedId(publishedId);
      if (!post) throw new NewsCheckError("That DailyMattr link doesn't match any published PIX.", 404);
    }
  } else {
    throw new NewsCheckError("Paste a news link.", 400);
  }

  let news: NewsInput;
  if (post) {
    const hit = input.force ? null : getCachedCheck(post.id);
    // Saved before verdicts existed: check again rather than show none.
    if (hit?.verdict) return { ...hit, cached: true, articleText: post.body };
    news = fromPix(post);
  } else {
    const article = await fetchArticle(url);
    if (!article.title || article.text.length < 200 || looksLikeBoilerplate(article.text)) {
      throw new NewsCheckError(
        "Couldn't read a news article at that link. Try the article's own page (not a home or live page).",
        422,
      );
    }
    news = {
      headline: article.title,
      summary: article.text,
      sourceTitle: "",
      sourceText: "",
      storyUrl: url,
      publishedAt: article.published,
      pageReviews: article.claimReviews,
    };
  }

  news.summary = news.summary.slice(0, 6000);
  const report = await runFactCheck(news);
  if (news.pixId) setCachedCheck(news.pixId, report);
  if (news.storyUrl) trustKnownOutlet(report, news.storyUrl, news.publishedAt ?? null);
  return { ...report, articleText: news.summary };
}

/** A link to a genuine article on a recognised outlet's own site (BBC,
 * Reuters, The Hindu, …) that nothing contradicts is real news, even when no
 * other outlet has covered it yet (an exclusive, a feature, or just very new):
 * "unverified, may be made up" would be wrong. Anything contradicted, or
 * found false by a fact-checker, keeps its false verdict. */
function trustKnownOutlet(report: FactCheckReport, url: string, publishedAt: string | null) {
  const outlet = knownOutletOf(url);
  if (!outlet || report.verdict.label !== "unverified" || report.verdict.basis !== "claims") return;
  if (report.claims.some((c) => c.verdict === "contradicted")) return;
  const day = publishedAt ? new Date(publishedAt) : null;
  const when =
    day && !Number.isNaN(day.getTime())
      ? `, published ${day.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}`
      : "";
  const covered = report.sources.some((s) => !s.primary);
  report.verdict = {
    label: "true",
    basis: "trusted-outlet",
    publisher: outlet,
    reason: `This is a genuine ${outlet} article, on ${outlet}'s own website${when}. ${
      covered
        ? "Other outlets have reported only parts of it so far, so not every detail could be cross-checked."
        : "No other outlet has reported it yet, so its details couldn't be cross-checked."
    }`,
  };
}
