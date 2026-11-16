import { checkForPage } from "@/lib/chat";
import { openaiConfigured } from "@/lib/factcheck";

/* The home page's "Fact check by NIA" box: the chat's check of a message or
 * a news link, plus the story and related DailyMattr stories. Open to anyone
 * who can reach this app, like /api/chat-demo. */
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!openaiConfigured()) return Response.json({ error: "OPENAI_API_KEY is not set in .env." }, { status: 503 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const { result, status } = await checkForPage(body);
  return Response.json(result, { status });
}
