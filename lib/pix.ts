import "server-only";
import { connection } from "next/server";

/* Read-only access to the Pixie CMS database (Supabase project "PixAgent").
 * pix_posts has no anon read policy, so this needs the service-role key —
 * which is why it lives in server-only code and is never prefixed NEXT_PUBLIC_. */

export type PixPostSummary = {
  id: string;
  headline: string;
  category: string | null;
  published_at: string | null;
  source_url: string | null;
  image: string | null;
  published_id: string | null; // its number on dailymattr.com (see dailyMattrUrl)
};

export type PixPost = PixPostSummary & {
  body: string;
  source_title: string; // the original article's headline, as scraped
  source_text: string;
  cards: string[]; // finished PIX card images (poster + text slides), in order
};

type WebPage = { url?: string; sort_order?: number };

type PixRow = {
  id: string;
  headline: string | null;
  ai_headline: string | null;
  scraped_title: string | null;
  detail_body?: string | null;
  summary?: string | null;
  article_text?: string | null;
  category: string | null;
  tag: string | null;
  published_at: string | null;
  created_at: string | null;
  source_url: string | null;
  main_image_url: string | null;
  source_image_url: string | null;
  web_pages: WebPage[] | null;
  published_id: string | number | null;
};

export function pixConfigured(): boolean {
  return Boolean(process.env.PIX_SUPABASE_URL && process.env.PIX_SUPABASE_SERVICE_ROLE_KEY);
}

async function pixFetch<T>(path: string, init?: { count?: boolean }): Promise<{ data: T; total: number | null }> {
  if (!pixConfigured()) {
    throw new Error("PIX_SUPABASE_URL / PIX_SUPABASE_SERVICE_ROLE_KEY are not set in .env");
  }
  // PIX news is live data: always read it at request time. Without this, Cache
  // Components tries to prerender and trips over AbortSignal.timeout's clock read.
  await connection();
  const key = process.env.PIX_SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${process.env.PIX_SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(init?.count ? { Prefer: "count=exact" } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`PIX database error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  // Content-Range: "0-11/9390"
  const total = Number(res.headers.get("content-range")?.split("/")[1]);
  return { data: (await res.json()) as T, total: Number.isFinite(total) ? total : null };
}

// PIX headlines wrap highlighted words in [brackets] for the card design.
const stripMarkers = (s: string) => s.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();

const headlineOf = (r: PixRow) => stripMarkers(r.headline || r.ai_headline || r.scraped_title || "(untitled)");

const cardsOf = (r: PixRow) =>
  (Array.isArray(r.web_pages) ? r.web_pages : [])
    .filter((p): p is Required<Pick<WebPage, "url">> & WebPage => typeof p?.url === "string")
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((p) => p.url);

const isHttp = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

const imageOf = (r: PixRow) =>
  [r.main_image_url, cardsOf(r)[0], r.source_image_url].find(isHttp) ?? null;

const toSummary = (r: PixRow): PixPostSummary => ({
  id: r.id,
  headline: headlineOf(r),
  // PIX stores the literal text "none" for posts without a category.
  category: [r.category, r.tag].find((c) => c && c.trim() && c.trim().toLowerCase() !== "none")?.trim() ?? null,
  published_at: r.published_at ?? r.created_at,
  source_url: r.source_url,
  image: imageOf(r),
  published_id: r.published_id === null || r.published_id === undefined ? null : String(r.published_id),
});

const LIST_COLS =
  "id,headline,ai_headline,scraped_title,category,tag,published_at,created_at,source_url,main_image_url,source_image_url,web_pages,published_id";

const searchTerm = (q: string) => q.trim().replace(/[*,()%\\]/g, " ").replace(/\s+/g, " ").slice(0, 80);

/** One page of published PIX posts, newest first, with the total count. */
export async function listPixPage(opts: { page: number; pageSize: number; query?: string }) {
  const page = Math.max(1, Math.floor(opts.page) || 1);
  const params = new URLSearchParams({
    select: LIST_COLS,
    published_id: "not.is.null",
    order: "published_at.desc.nullslast,created_at.desc",
    limit: String(opts.pageSize),
    offset: String((page - 1) * opts.pageSize),
  });
  const q = searchTerm(opts.query ?? "");
  if (q) params.set("or", `(headline.ilike.*${q}*,ai_headline.ilike.*${q}*)`);
  const { data, total } = await pixFetch<PixRow[]>(`pix_posts?${params}`, { count: true });
  const count = total ?? data.length;
  return {
    posts: data.map(toSummary),
    total: count,
    page,
    pageCount: Math.max(1, Math.ceil(count / opts.pageSize)),
  };
}

/** Latest published PIX posts (used by the JSON API). */
export async function listPixPosts(query: string, limit = 30): Promise<PixPostSummary[]> {
  return (await listPixPage({ page: 1, pageSize: limit, query })).posts;
}

/** DailyMattr news pages are /news/<headline-slug>-<published_id>
 * (Dailymattrmain api/_lib/slug.js). Returns that published_id, or null. */
export function publishedIdFromDailyMattrUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^(www\.)?dailymattr\.com$/i.test(u.hostname)) return null;
    return u.pathname.match(/^\/news\/(?:[^/]+\/)?[^/]*-(\d+)\/?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The PIX's public page on dailymattr.com. The site finds a story by its
 * number alone and redirects to its canonical slug, so the slug here only has
 * to be readable. */
export function dailyMattrUrl(post: Pick<PixPostSummary, "headline" | "published_id">): string | null {
  if (!post.published_id) return null;
  const slug = post.headline
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return `https://www.dailymattr.com/news/${slug ? `${slug}-` : ""}${post.published_id}`;
}

export async function getPixPostByPublishedId(publishedId: string): Promise<PixPost | null> {
  if (!/^\d{1,12}$/.test(publishedId)) return null;
  return fetchPixPost({ published_id: `eq.${publishedId}` });
}

export async function getPixPost(id: string): Promise<PixPost | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return fetchPixPost({ id: `eq.${id}` });
}

async function fetchPixPost(filter: Record<string, string>): Promise<PixPost | null> {
  const params = new URLSearchParams({
    select: `${LIST_COLS},detail_body,summary,article_text`,
    ...filter,
    order: "published_at.desc.nullslast",
    limit: "1",
  });
  const {
    data: [row],
  } = await pixFetch<PixRow[]>(`pix_posts?${params}`);
  if (!row) return null;
  return {
    ...toSummary(row),
    // Same [highlight] markers as headlines; keep line breaks for paragraphs.
    body: (row.detail_body || row.summary || "").replace(/[[\]]/g, "").trim(),
    source_title: (row.scraped_title || "").trim(),
    source_text: (row.article_text || "").trim(),
    cards: cardsOf(row),
  };
}
