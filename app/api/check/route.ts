import { getCachedCheck, setCachedCheck } from "@/lib/check-cache";
import { openaiConfigured, runFactCheck, type NewsInput } from "@/lib/factcheck";
import { fetchArticle, isHttpUrl, looksLikeBoilerplate } from "@/lib/fetch-article";
import { getPixPost, getPixPostByPublishedId, publishedIdFromDailyMattrUrl, type PixPost } from "@/lib/pix";

// Reading the articles + news searches + three or four model calls (event
// queries, extract claims, verify, second look): usually 15–30 s.
export const maxDuration = 60;

/** Either a PIX id (PIX pages) or a news link (the "Check a news link" page). */
type CheckBody = { pixId?: string; url?: string; force?: boolean };

/* Reopening a PIX should not re-run the check every time. Results are kept in
 * memory for 6 hours (lib/check-cache.ts); "Re-check" sends force=true. */

const fromPix = (post: PixPost): NewsInput => ({
  headline: post.headline,
  summary: post.body,
  sourceTitle: post.source_title,
  sourceText: post.source_text,
  sourceUrl: post.source_url,
  publishedAt: post.published_at,
  pixId: post.id,
});

const error = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  if (!openaiConfigured()) return error("OPENAI_API_KEY is not set in .env.", 503);

  let body: CheckBody;
  try {
    body = (await request.json()) as CheckBody;
  } catch {
    return error("Invalid JSON body.", 400);
  }

  let news: NewsInput;
  try {
    let post: PixPost | null = null;
    const url = (body.url ?? "").trim();

    if (body.pixId) {
      post = await getPixPost(body.pixId);
      if (!post) return error("PIX post not found.", 404);
    } else if (url) {
      if (!isHttpUrl(url)) return error("Paste a full link starting with http:// or https://", 400);
      // A DailyMattr news page is a PIX: check it the same way as on its PIX page.
      const publishedId = publishedIdFromDailyMattrUrl(url);
      if (publishedId) {
        post = await getPixPostByPublishedId(publishedId);
        if (!post) return error("That DailyMattr link doesn't match any published PIX.", 404);
      }
    } else {
      return error("Paste a news link.", 400);
    }

    if (post) {
      const hit = body.force ? null : getCachedCheck(post.id);
      // Saved before verdicts existed: check again rather than show none.
      if (hit?.verdict) return Response.json({ ...hit, cached: true });
      news = fromPix(post);
    } else {
      // Any other news link: that article is the story; other outlets that
      // published the same news are the evidence.
      const article = await fetchArticle(url);
      if (!article.title || article.text.length < 200 || looksLikeBoilerplate(article.text)) {
        return error("Couldn't read a news article at that link. Try the article's own page (not a home or live page).", 422);
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
  } catch (err) {
    return error((err as Error).message, 502);
  }

  news.summary = news.summary.slice(0, 6000);

  try {
    const report = await runFactCheck(news);
    if (news.pixId) setCachedCheck(news.pixId, report);
    return Response.json(report);
  } catch (err) {
    console.error("[fact-check]", err);
    return error(`Fact check failed: ${(err as Error).message}`, 502);
  }
}
