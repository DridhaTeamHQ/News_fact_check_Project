import "server-only";

/* Best-effort reader for a pasted news link: pulls the title and main text out
 * of the HTML. No third-party service; good enough for most news pages. */

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const meta = (html: string, prop: string) =>
  html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)`, "i"))?.[1] ??
  html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1];

const BOILERPLATE = /\b(cookies?|privacy policy|terms of (use|service)|subscribe|newsletter|sign in|log in|calculator|advertisement|all rights reserved)\b/i;

/** True when scraped text is mostly site furniture (cookie notices, widgets)
 * rather than the article — PIX sometimes stores exactly that. */
export function looksLikeBoilerplate(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 20);
  if (sentences.length === 0) return true;
  const junk = sentences.filter((s) => BOILERPLATE.test(s)).length;
  return junk / sentences.length >= 0.3;
}

type LdArticle ={ headline?: string; articleBody?: string; description?: string; datePublished?: string };

/** The page's NewsArticle/Article JSON-LD block, if any (handles @graph and arrays). */
function jsonLdArticle(html: string): LdArticle {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let best: LdArticle = {};
  for (const [, raw] of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    const queue: unknown[] = [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (Array.isArray(node)) {
        queue.push(...node);
        continue;
      }
      if (!node || typeof node !== "object") continue;
      const o = node as Record<string, unknown>;
      if (Array.isArray(o["@graph"])) queue.push(...(o["@graph"] as unknown[]));
      const type = String(o["@type"] ?? "");
      if (/Article|NewsArticle|ReportageNewsArticle|BlogPosting/i.test(type)) {
        const body = typeof o.articleBody === "string" ? o.articleBody : undefined;
        if ((body?.length ?? 0) > (best.articleBody?.length ?? 0) || !best.headline) {
          best = {
            headline: typeof o.headline === "string" ? o.headline : best.headline,
            articleBody: body ?? best.articleBody,
            description: typeof o.description === "string" ? o.description : best.description,
            datePublished: typeof o.datePublished === "string" ? o.datePublished : best.datePublished,
          };
        }
      }
    }
  }
  return best;
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function fetchArticle(url: string): Promise<{ title: string; text: string; published: string | null }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FactCheckMediator/1.0)", Accept: "text/html" },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Could not open the link (HTTP ${res.status})`);
  const html = (await res.text()).slice(0, 2_000_000);

  const ld = jsonLdArticle(html);
  const title = decode(
    ld.headline ?? meta(html, "og:title") ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
  ).trim();
  const published = ld.datePublished ?? meta(html, "article:published_time") ?? null;

  // 1. Structured data: most news sites put the full body in JSON-LD for search
  //    engines. On sites like Times of India the <p> tags are widgets and
  //    cookie notices, so this is far more reliable than scraping paragraphs.
  if (ld.articleBody && ld.articleBody.length > 200) {
    return { title, text: decode(ld.articleBody).replace(/\s+/g, " ").trim().slice(0, 8000), published };
  }

  // 2. Paragraphs inside <article>, else the whole page, minus boilerplate.
  const scope = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  const paragraphs = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 60 && !BOILERPLATE.test(p));
  const text = paragraphs.join("\n\n").slice(0, 8000) || decode(ld.description ?? meta(html, "og:description") ?? "");

  return { title, text, published };
}
