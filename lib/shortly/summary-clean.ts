import "server-only";

/* Ported from Shortly-email-agent: supabase/functions/_shared/summary-clean.ts
 * (only the two pieces the fact check uses: stripSourceArtifacts and
 * chatCompletionRaw). Deno → Node: nothing else changed. */

const AGENCY_TAG = /\((?:PTI|AFP|ANI|IANS|Reuters|AP|Bloomberg)\)/g;

export function stripSourceArtifacts(input: string): string {
  let t = String(input || "");

  // "SUMMARY"/"Summary" header bleed-through and leading label.
  t = t.replace(/\b(SUMMARY|Summary)(?=[A-Z])/g, "");
  t = t.replace(/^\s*summary[:\s-]+/i, "");

  // CMS metadata stack.
  t = t.replace(/Published on:\s*\d{1,2}\s+\w+\s+\d{4},\s*\d{1,2}:\d{2}\s*[ap]m/gi, " ");
  t = t.replace(/Updated:\s*\w+\s+\d{1,2},\s*\d{4}\s+\d{1,2}:\d{2}\s*[AP]M(?:\s*IST)?/gi, " ");
  t = t.replace(/\b\d+\s*min read\b/gi, " ");
  t = t.replace(/\bListen to this article\b/gi, " ");

  // Agency tags, bare parenthetical date stamps, bracketed case cites.
  t = t.replace(AGENCY_TAG, " ");
  t = t.replace(
    /\((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\)/gi,
    " ",
  );

  // Photo / image credit furniture.
  t = t.replace(/\(Photo[^)]*\)/gi, " ");
  t = t.replace(/\(Image[^)]*\)/gi, " ");
  t = t.replace(/\([^)]*\/\s*(?:Hindustan Times|Reuters|AFP|PTI|ANI|Getty|AP|Bloomberg)\)/gi, " ");
  t = t.replace(/\bPhoto for representational purposes only\b/gi, " ");

  // Inline CTA promos in the body.
  for (const p of [
    /\bAlso read[:\s][^.?!]*/gi,
    /\bRead also[:\s][^.?!]*/gi,
    /\bMust read[:\s][^.?!]*/gi,
    /\bWatch[:\s][^.?!]*/gi,
    /\bWatch the (?:video|full)[^.?!]*/gi,
    /\bClick here[^.?!]*/gi,
  ])
    t = t.replace(p, " ");

  // Dateline prefixes (CITY: / Mumbai:) at body start or after a sentence break.
  t = t.replace(/(^|[.?!]\s)([A-Z][A-Za-z]+(?:[ -][A-Z][A-Za-z]+){0,2}):\s(?=[A-Z])/g, "$1");

  return t.replace(/[ \t]{2,}/g, " ").trim();
}

export async function chatCompletionRaw(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  opts: { jsonMode?: boolean; temperature?: number } = {},
): Promise<string> {
  const payload = {
    model,
    temperature: opts.temperature ?? 0.3,
    max_tokens: maxTokens,
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (response.ok) {
      const raw = (await response.json())?.choices?.[0]?.message?.content?.trim();
      if (!raw) throw new Error("empty completion");
      return raw;
    }
    const body = await response.text().catch(() => "");
    if (response.status === 429 && !body.includes("insufficient_quota") && attempt < 2) {
      const m = body.match(/try again in ([\d.]+)s/i);
      const waitMs = Math.min((m ? parseFloat(m[1]) + 1 : 8) * 1000, 25_000);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (response.status === 429 && body.includes("insufficient_quota")) {
      throw new Error("OpenAI quota exceeded. Add billing credits or update OPENAI_API_KEY.");
    }
    if (response.status === 401) throw new Error("OpenAI API key is invalid or expired.");
    throw new Error(`OpenAI ${response.status}: ${body.slice(0, 220)}`);
  }
  throw new Error("OpenAI 429: rate limit retries exhausted");
}
