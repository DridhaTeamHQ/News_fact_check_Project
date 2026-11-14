import { openaiConfigured } from "@/lib/factcheck";
import { checkText, getCachedTextCheck, NotNewsError } from "@/lib/text-check";

// Restating the claim, a DailyMattr search, the full fact check (25–50 s) and
// writing the real news: usually 35–70 s.
export const maxDuration = 120;

const error = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  if (!openaiConfigured()) return error("OPENAI_API_KEY is not set in .env.", 503);

  let body: { text?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body.", 400);
  }

  const text = String(body.text ?? "").trim();
  if (text.length < 15) return error("Paste the full message: it's too short to check.", 400);
  if (text.length > 5000) return error("That's too long. Paste one message of up to 5,000 characters.", 400);

  const hit = body.force ? null : getCachedTextCheck(text);
  if (hit) return Response.json(hit);

  try {
    return Response.json(await checkText(text));
  } catch (err) {
    if (err instanceof NotNewsError) return error(err.message, 422);
    console.error("[check-text]", err);
    return error(`Fact check failed: ${(err as Error).message}`, 502);
  }
}
