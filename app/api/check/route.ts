import { openaiConfigured } from "@/lib/factcheck";
import { checkNews, NewsCheckError } from "@/lib/news-check";

// Reading the articles + news and fact-checker searches + four or five model
// calls (event queries, extract claims, verify, second look, fact-check match):
// usually 25–50 s.
export const maxDuration = 120;

/** Either a PIX id (PIX pages) or a news link (the "Check a news link" page). */
type CheckBody = { pixId?: string; url?: string; force?: boolean };

const error = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  if (!openaiConfigured()) return error("OPENAI_API_KEY is not set in .env.", 503);

  let body: CheckBody;
  try {
    body = (await request.json()) as CheckBody;
  } catch {
    return error("Invalid JSON body.", 400);
  }

  try {
    const result = await checkNews({ pixId: body.pixId, url: body.url, force: Boolean(body.force) });
    delete result.articleText; // only the chat's follow-up questions use it
    return Response.json(result);
  } catch (err) {
    if (err instanceof NewsCheckError) return error(err.message, err.status);
    console.error("[fact-check]", err);
    return error(`Fact check failed: ${(err as Error).message}`, 502);
  }
}
