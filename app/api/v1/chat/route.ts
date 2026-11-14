import { createHash, timingSafeEqual } from "node:crypto";
import { respond } from "@/lib/chat";
import { openaiConfigured } from "@/lib/factcheck";

/* The WhatsApp chatbot's API: POST one incoming WhatsApp message, get back the
 * bot's replies ready to send. Docs: docs/chat-api.md.
 *
 * A check reads dozens of pages and takes 30–70 seconds (milliseconds when the
 * same forward was checked in the last 6 hours), so call this from a
 * background job, not inside WhatsApp's webhook request. */
export const maxDuration = 120;

/** `Authorization: Bearer <CHAT_API_KEY>` or `X-API-Key: <CHAT_API_KEY>`. */
function authorised(request: Request): boolean {
  const expected = process.env.CHAT_API_KEY ?? "";
  const given =
    request.headers.get("x-api-key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  // Compare digests: equal length, constant time.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return expected.length > 0 && timingSafeEqual(a, b);
}

const error = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  if (!process.env.CHAT_API_KEY) return error("CHAT_API_KEY is not set in .env.", 503);
  if (!authorised(request)) return error("Missing or wrong API key.", 401);
  if (!openaiConfigured()) return error("OPENAI_API_KEY is not set in .env.", 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Send a JSON body.", 400);
  }
  if (!body || typeof body !== "object") return error("Send a JSON body.", 400);

  const { reply, status } = await respond(body);
  return Response.json(reply, { status });
}
