import { openaiConfigured, runFactCheck, type FactCheckReport, type NewsInput } from "@/lib/factcheck";
import { isHttpUrl } from "@/lib/fetch-article";
import { getPixPost } from "@/lib/pix";

// Reading the source article + one gpt-4o-mini call: usually 5–20 s.
export const maxDuration = 60;

type CheckBody = { pixId?: string; text?: string; sourceUrl?: string; force?: boolean };

/* Reopening a PIX should not re-run the check every time. Results are kept in
 * memory per server process for 6 hours; "Re-check" sends force=true. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const pixCache = new Map<string, { at: number; report: FactCheckReport }>();

export async function POST(request: Request) {
  if (!openaiConfigured()) {
    return Response.json({ error: "OPENAI_API_KEY is not set in .env." }, { status: 503 });
  }

  let body: CheckBody;
  try {
    body = (await request.json()) as CheckBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let news: NewsInput;
  try {
    if (body.pixId) {
      const hit = pixCache.get(body.pixId);
      if (hit && !body.force && Date.now() - hit.at < CACHE_TTL_MS) {
        return Response.json({ ...hit.report, cached: true });
      }
      const post = await getPixPost(body.pixId);
      if (!post) return Response.json({ error: "PIX post not found." }, { status: 404 });
      news = {
        headline: post.headline,
        summary: post.body,
        sourceTitle: post.source_title,
        sourceText: post.source_text,
        sourceUrl: post.source_url,
        publishedAt: post.published_at,
        pixId: post.id,
      };
    } else {
      const text = (body.text ?? "").trim();
      const sourceUrl = (body.sourceUrl ?? "").trim();
      if (!text) return Response.json({ error: "Paste the news headline and text." }, { status: 400 });
      if (sourceUrl && !isHttpUrl(sourceUrl)) {
        return Response.json({ error: "The source link must start with http:// or https://" }, { status: 400 });
      }
      const [first, ...rest] = text.split(/\r?\n/);
      news = {
        headline: first.trim().slice(0, 300),
        summary: rest.join("\n").trim() || first.trim(),
        sourceTitle: "",
        sourceText: "",
        sourceUrl: sourceUrl || null,
      };
    }
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }

  news.summary = news.summary.slice(0, 6000);

  try {
    const report = await runFactCheck(news);
    if (news.pixId) {
      pixCache.set(news.pixId, { at: Date.now(), report });
      if (pixCache.size > 500) pixCache.delete(pixCache.keys().next().value!);
    }
    return Response.json(report);
  } catch (err) {
    console.error("[fact-check]", err);
    return Response.json({ error: `Fact check failed: ${(err as Error).message}` }, { status: 502 });
  }
}
