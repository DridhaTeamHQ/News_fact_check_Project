import "server-only";
import { embedTexts } from "./shortly/embeddings";
import { jaccard, MIN_JACCARD, MIN_SHARED_TOKENS, significantTokens, type RelatedSource } from "./shortly/related-sources";

/* More outlets that published the same story, beyond Shortly's own feeds.
 *
 * Uses the public Bing News and Google News RSS search feeds (no API key).
 * Bing gives a snippet of what each outlet wrote and the publisher's direct
 * URL; Google adds more outlets (headline only, behind a Google redirect link).
 *
 * "Same story" uses Shortly's rule: title embeddings with cosine distance
 * under 0.4 (text-embedding-3-small), falling back to Shortly's token-overlap
 * rule (3 shared significant words, or Jaccard ≥ 0.28) if embedding fails. */

export type FoundArticle = RelatedSource & { published: string | null; via: "bing" | "google" };

const FEED_TIMEOUT_MS = 8_000;
const WINDOW_DAYS = 3;
const MAX_EMBED_DISTANCE = 0.4; // same threshold as Shortly's match_related_articles

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;[^&]*?&gt;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

const tag = (item: string, name: string) =>
  item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";

const items = (xml: string) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

/** Outlet name normalised for "one article per outlet". */
export const outletKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s+on msn$/, "")
    .replace(/^the\s+/, "")
    .replace(/\.(com|in|co\.in|net|org)$/, "")
    .replace(/[^a-z0-9]+/g, "");

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FactCheckMediator/1.0)", Accept: "application/rss+xml, text/xml" },
      cache: "no-store",
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function searchBing(query: string): Promise<FoundArticle[]> {
  const xml = await getText(
    `https://www.bing.com/news/search?${new URLSearchParams({ q: query, format: "rss", setmkt: "en-IN", count: "30" })}`,
  );
  if (!xml) return [];
  return items(xml).flatMap((it) => {
    const link = decode(tag(it, "link"));
    let url = link;
    try {
      url = new URL(link).searchParams.get("url") || link; // apiclick → publisher URL
    } catch {
      /* keep link */
    }
    const source = decode(tag(it, "News:Source")).replace(/\s+on MSN$/i, "");
    const title = decode(tag(it, "title"));
    if (!title || !url || !source) return [];
    const pub = decode(tag(it, "pubDate"));
    return [
      {
        source,
        url,
        title,
        excerpt: decode(tag(it, "description")).slice(0, 300),
        published: pub ? new Date(pub).toISOString() : null,
        via: "bing" as const,
      },
    ];
  });
}

async function searchGoogle(query: string, anchor: Date): Promise<FoundArticle[]> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const after = new Date(anchor.getTime() - WINDOW_DAYS * 86_400_000);
  const before = new Date(anchor.getTime() + (WINDOW_DAYS + 1) * 86_400_000);
  const q = `${query} after:${day(after)} before:${day(before)}`;
  const xml = await getText(`https://news.google.com/rss/search?${new URLSearchParams({ q, hl: "en-IN", gl: "IN", ceid: "IN:en" })}`);
  if (!xml) return [];
  return items(xml).flatMap((it) => {
    const source = decode(tag(it, "source"));
    // Google appends " - Outlet" to every headline.
    const title = decode(tag(it, "title")).replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
    const url = decode(tag(it, "link"));
    if (!title || !url || !source) return [];
    const pub = decode(tag(it, "pubDate"));
    return [{ source, url, title, excerpt: "", published: pub ? new Date(pub).toISOString() : null, via: "google" as const }];
  });
}

const cosineDistance = (a: number[], b: number[]) => {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

/** Keep only candidates about the same story as `title`, best match first. */
async function sameStory(apiKey: string, title: string, candidates: FoundArticle[]): Promise<FoundArticle[]> {
  if (candidates.length === 0) return [];
  const vectors = await embedTexts(apiKey, [title, ...candidates.map((c) => c.title)]);
  if (vectors && vectors.length === candidates.length + 1) {
    const [self, ...rest] = vectors;
    return candidates
      .map((c, i) => ({ c, d: cosineDistance(self, rest[i]) }))
      .filter((x) => x.d < MAX_EMBED_DISTANCE)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.c);
  }
  // Fallback: Shortly's token-overlap rule.
  const own = new Set(significantTokens(title));
  return candidates
    .map((c) => {
      const cand = new Set(significantTokens(c.title));
      let shared = 0;
      for (const t of cand) if (own.has(t)) shared++;
      return { c, shared, jac: jaccard(own, cand) };
    })
    .filter((x) => x.shared >= MIN_SHARED_TOKENS || x.jac >= MIN_JACCARD)
    .sort((a, b) => b.shared - a.shared || b.jac - a.jac)
    .map((x) => x.c);
}

/** Up to `limit` other outlets that published this story (one per outlet),
 * excluding outlets in `excludeOutlets`. Never throws. */
export async function findOutletsCovering(
  apiKey: string,
  story: { title: string; publishedAt?: string | null },
  opts: { limit: number; excludeOutlets: string[] },
): Promise<FoundArticle[]> {
  try {
    const anchorMs = story.publishedAt ? new Date(story.publishedAt).getTime() : Date.now();
    const anchor = new Date(Number.isFinite(anchorMs) ? anchorMs : Date.now());
    const query = story.title.replace(/["“”]/g, "").slice(0, 160);

    const [bing, google] = await Promise.all([searchBing(query), searchGoogle(query, anchor)]);
    const windowMs = (WINDOW_DAYS + 1) * 86_400_000;
    const inWindow = (a: FoundArticle) => !a.published || Math.abs(new Date(a.published).getTime() - anchor.getTime()) <= windowMs;

    const excluded = new Set(opts.excludeOutlets.map(outletKey));
    const pool = [...bing, ...google].filter((a) => inWindow(a) && !excluded.has(outletKey(a.source)));

    // Match first, then keep each outlet's best match. When Bing and Google
    // both have an outlet's article, prefer Bing's (snippet + direct link).
    const matched = await sameStory(apiKey, story.title, pool);
    const byOutlet = new Map<string, FoundArticle>();
    for (const a of matched) {
      const key = outletKey(a.source);
      const prev = byOutlet.get(key);
      if (!prev) byOutlet.set(key, a);
      else if (prev.via === "google" && a.via === "bing") byOutlet.set(key, { ...a });
    }
    return [...byOutlet.values()].slice(0, opts.limit);
  } catch {
    return [];
  }
}
