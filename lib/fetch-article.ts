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

/** A fact-checker's verdict published on the page (schema.org ClaimReview, the
 * markup BOOM, Alt News, Factly, AFP, Snopes and others use for search engines):
 * the claim that was checked and the rating, e.g. "False" or "Misleading". */
export type ClaimReview = { claim: string; rating: string; by: string | null };

const LD_BLOCKS = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const nameOf = (v: unknown): string | null => {
  const first = Array.isArray(v) ? v[0] : v;
  const name = first && typeof first === "object" ? (first as Record<string, unknown>).name : null;
  return typeof name === "string" && name.trim() ? name.trim() : null;
};

/** Every ClaimReview on the page. Tolerates slightly broken JSON-LD, which
 * some fact-check sites ship, by reading the two fields directly. */
function claimReviewsIn(html: string): ClaimReview[] {
  const out: ClaimReview[] = [];
  for (const [, raw] of html.matchAll(LD_BLOCKS)) {
    if (!/ClaimReview/i.test(raw)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      const field = (k: string) => raw.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))?.[1];
      const claim = field("claimReviewed");
      const rating = field("alternateName");
      if (claim && rating) out.push({ claim: decode(claim).trim(), rating: decode(rating).trim(), by: null });
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
      if (!/ClaimReview/i.test(String(o["@type"] ?? ""))) continue;
      const rating = (o.reviewRating ?? {}) as Record<string, unknown>;
      const claim = typeof o.claimReviewed === "string" ? o.claimReviewed.trim() : "";
      const word = typeof rating.alternateName === "string" ? rating.alternateName.trim() : "";
      // The organisation that published the check (its author is often a person).
      const author = (Array.isArray(o.author) ? o.author[0] : o.author) as Record<string, unknown> | undefined;
      const by = nameOf(o.publisher) ?? (author?.["@type"] === "Organization" ? nameOf(author) : null);
      if (claim && word) out.push({ claim: decode(claim), rating: decode(word), by });
    }
  }
  const seen = new Set<string>();
  return out
    .filter((r) => {
      const key = `${r.claim}|${r.rating}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

/** The page's NewsArticle/Article JSON-LD block, if any (handles @graph and arrays). */
function jsonLdArticle(html: string): LdArticle {
  const blocks = [...html.matchAll(LD_BLOCKS)];
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

export type Article = { title: string; text: string; published: string | null; claimReviews: ClaimReview[] };

const MAX_ATTEMPTS = 3;
const RETRY_BUDGET_MS = 8_000; // quick failures are retried; a 10 s timeout is not
/** The page is gone or needs a login: trying again won't change that. */
const PERMANENT = new Set([400, 401, 404, 410, 451]);

/** Reads a news page. Sites fail intermittently (a dropped connection, a 5xx,
 * a 403 one moment and 200 the next), and a failed read changes which evidence
 * a story is graded against, so quick transient failures are retried. */
export async function fetchArticle(url: string): Promise<Article> {
  const started = Date.now();
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      if (Date.now() - started > RETRY_BUDGET_MS) break;
      await new Promise((r) => setTimeout(r, attempt * 700));
    }
    try {
      return await fetchArticleOnce(url);
    } catch (err) {
      lastError = err;
      if (PERMANENT.has((err as { status?: number }).status ?? 0)) break;
    }
  }
  throw lastError;
}

async function fetchArticleOnce(url: string): Promise<Article> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FactCheckMediator/1.0)", Accept: "text/html" },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw Object.assign(
      new Error(
        res.status === 404 || res.status === 410
          ? `That page wasn't found (HTTP ${res.status}). Check the link and try again.`
          : res.status === 401 || res.status === 403 || res.status === 429
            ? `That site blocks automatic reading (HTTP ${res.status}), so its page can't be read.`
            : `Could not open the link (HTTP ${res.status}).`,
      ),
      { status: res.status },
    );
  }
  const html = (await res.text()).slice(0, 2_000_000);

  const ld = jsonLdArticle(html);
  const title = decode(
    ld.headline ?? meta(html, "og:title") ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
  ).trim();
  const published = ld.datePublished ?? meta(html, "article:published_time") ?? null;
  const claimReviews = claimReviewsIn(html);

  // 1. Structured data: most news sites put the full body in JSON-LD for search
  //    engines. On sites like Times of India the <p> tags are widgets and
  //    cookie notices, so this is far more reliable than scraping paragraphs.
  if (ld.articleBody && ld.articleBody.length > 200) {
    return { title, text: decode(ld.articleBody).replace(/\s+/g, " ").trim().slice(0, 8000), published, claimReviews };
  }

  // 2. Paragraphs inside <article>, else the whole page, minus boilerplate.
  const scope = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  const paragraphs = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 60 && !BOILERPLATE.test(p));
  const text = paragraphs.join("\n\n").slice(0, 8000) || decode(ld.description ?? meta(html, "og:description") ?? "");

  return { title, text, published, claimReviews };
}
