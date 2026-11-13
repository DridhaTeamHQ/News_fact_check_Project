import "server-only";
import { embedText } from "./embeddings";

/* Ported from Shortly-email-agent: supabase/functions/_shared/related-sources.ts
 *
 * Finds OTHER outlets in Shortly's own scrape pool (60+ RSS feeds, the
 * `articles` table) that covered the SAME story, so the fact check can
 * corroborate claims across independent sources. No web search.
 *
 * Changes from the original, all mechanical:
 *  - supabase-js calls → Supabase REST with Shortly's PUBLISHABLE key. Row
 *    Level Security limits that key to approved/sent articles, the same rows
 *    Shortly's public site shows. The match_related_articles RPC runs as the
 *    caller, so it is limited the same way.
 *  - Shortly embeds titles at scrape time; a PIX has no stored embedding, so
 *    the title is embedded here with the same model (text-embedding-3-small).
 * Matching rules, thresholds and stopwords are unchanged. */

export type RelatedSource = {
  source: string;
  url: string;
  title: string;
  excerpt: string;
};

// Common words that carry no story identity — never count them as a shared token.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "to", "of", "in", "on", "at", "by",
  "with", "from", "as", "is", "are", "was", "were", "be", "been", "has", "have",
  "had", "will", "would", "can", "could", "may", "might", "this", "that", "these",
  "those", "it", "its", "his", "her", "their", "our", "your", "not", "no", "new",
  "over", "after", "before", "into", "out", "up", "down", "off", "more", "most",
  "amid", "says", "said", "report", "reports", "reportedly", "how", "why", "what",
  "when", "who", "which", "top", "big", "set", "get", "gets", "day", "year", "years",
  "week", "india", "indian",
]);

// Significant tokens = words that identify the story: length >= 4, not a
// stopword, OR any token containing a digit (figures/dates are strong signals).
export function significantTokens(title: string): string[] {
  const raw = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const hasDigit = /\d/.test(t);
    if (!hasDigit && (t.length < 4 || STOPWORDS.has(t))) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export const RELATED_WINDOW_MS = 48 * 60 * 60 * 1000;
export const MIN_SHARED_TOKENS = 3; // need 3 shared significant tokens...
export const MIN_JACCARD = 0.28; // ...or a strong overall overlap
export const MAX_RELATED = 4; // cap corroborating outlets we record/prompt

// Cosine distance under MAX_EMBED_DISTANCE means "same story even when worded
// completely differently" — far better recall than token overlap.
const MAX_EMBED_DISTANCE = 0.4;

type ArticleRow = { id?: string; title?: string; url?: string; source?: string | null; summary?: string | null };

export function shortlyConfigured(): boolean {
  return Boolean(process.env.SHORTLY_SUPABASE_URL && process.env.SHORTLY_SUPABASE_PUBLISHABLE_KEY);
}

async function shortlyRest<T>(path: string, init?: { body?: unknown }): Promise<T | null> {
  if (!shortlyConfigured()) return null;
  const key = process.env.SHORTLY_SUPABASE_PUBLISHABLE_KEY!;
  try {
    const res = await fetch(`${process.env.SHORTLY_SUPABASE_URL}/rest/v1/${path}`, {
      method: init?.body ? "POST" : "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function toRelated(rows: ArticleRow[], selfUrl: string, selfSource: string): RelatedSource[] {
  const perSource = new Set<string>();
  const out: RelatedSource[] = [];
  for (const row of rows) {
    if (!row?.title || !row?.url || row.url === selfUrl) continue;
    if (selfSource && String(row.source || "").toLowerCase() === selfSource) continue;
    const key = String(row.source || row.url).toLowerCase();
    if (perSource.has(key)) continue;
    perSource.add(key);
    out.push({
      source: String(row.source || "").trim() || "Other outlet",
      url: String(row.url),
      title: String(row.title).trim().slice(0, 300),
      excerpt: String(row.summary || "").trim().slice(0, 240),
    });
    if (out.length >= MAX_RELATED) break;
  }
  return out;
}

async function findByEmbedding(
  apiKey: string,
  article: { title: string; source?: string | null; url?: string | null },
  since: string,
  until: string,
): Promise<RelatedSource[] | null> {
  const embedding = await embedText(apiKey, article.title);
  if (!embedding || embedding.length === 0) return null;
  const rows = await shortlyRest<ArticleRow[]>("rpc/match_related_articles", {
    body: {
      p_embedding: embedding,
      p_since: since,
      p_until: until,
      p_exclude_id: null,
      p_exclude_source: article.source ?? null,
      p_max_distance: MAX_EMBED_DISTANCE,
      p_limit: 10,
    },
  });
  if (!rows) return null;
  return toRelated(rows, String(article.url || ""), "");
}

/** Up to MAX_RELATED sibling articles from DIFFERENT sources covering the same
 * story. Never throws — on any error it returns [] so scoring proceeds
 * single-source. Embedding match first, token overlap as the fallback. The
 * window is anchored on the story's own time (±48h). */
export async function findRelatedSources(
  apiKey: string,
  article: { title: string; source?: string | null; url?: string | null; scrapedAt?: string | null },
): Promise<RelatedSource[]> {
  try {
    const anchorMs = article.scrapedAt ? new Date(article.scrapedAt).getTime() : Date.now();
    const anchor = Number.isFinite(anchorMs) ? anchorMs : Date.now();
    const since = new Date(anchor - RELATED_WINDOW_MS).toISOString();
    const until = new Date(anchor + RELATED_WINDOW_MS).toISOString();

    const viaEmbedding = await findByEmbedding(apiKey, article, since, until);
    if (viaEmbedding && viaEmbedding.length > 0) return viaEmbedding;

    const tokens = significantTokens(article.title);
    if (tokens.length < 2) return [];
    const tokenSet = new Set(tokens);
    // Query on the few most distinctive tokens (longest first — proper nouns and
    // numbers tend to be longer/rarer) to keep the candidate set small.
    const probes = [...tokens].sort((a, b) => b.length - a.length).slice(0, 5);
    const params = new URLSearchParams({ select: "id,title,url,source,summary", status: "neq.rejected", limit: "60" });
    params.append("scraped_at", `gte.${since}`);
    params.append("scraped_at", `lte.${until}`);
    params.set("or", `(${probes.map((t) => `title.ilike.*${t}*`).join(",")})`);
    const data = await shortlyRest<ArticleRow[]>(`articles?${params}`);
    if (!data) return [];

    const selfSource = String(article.source || "").toLowerCase();
    const selfUrl = String(article.url || "");
    const scored: Array<{ row: ArticleRow; shared: number; jac: number }> = [];
    for (const row of data) {
      if (!row?.title || !row?.url || row.url === selfUrl) continue;
      // Independent outlet only: corroboration must come from a DIFFERENT publisher.
      if (String(row.source || "").toLowerCase() === selfSource) continue;
      const cand = new Set(significantTokens(row.title));
      let shared = 0;
      for (const t of cand) if (tokenSet.has(t)) shared++;
      const jac = jaccard(tokenSet, cand);
      if (shared >= MIN_SHARED_TOKENS || jac >= MIN_JACCARD) scored.push({ row, shared, jac });
    }
    // Best matches first; keep one article per distinct source.
    scored.sort((a, b) => b.shared - a.shared || b.jac - a.jac);
    return toRelated(
      scored.map((s) => s.row),
      selfUrl,
      selfSource,
    );
  } catch {
    return [];
  }
}
