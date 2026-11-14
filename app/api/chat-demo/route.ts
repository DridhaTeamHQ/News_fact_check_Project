import { respond } from "@/lib/chat";
import { openaiConfigured } from "@/lib/factcheck";

/* The web demo's chat (/verify): the same replies as the WhatsApp API
 * (/api/v1/chat), without the API key, which must never reach the browser.
 * Like /api/check-text, it is open to anyone who can reach this app. */
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!openaiConfigured()) return Response.json({ error: "OPENAI_API_KEY is not set in .env." }, { status: 503 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const { reply, status } = await respond(body);
  return Response.json(reply, { status });
}
