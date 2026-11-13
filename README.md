# News Fact Check

Checks whether DailyMattr's PIX news stories match what the original article and
other outlets reported, and gives each story a fact score with its sources.

- **`/`**: all published PIX news with photos, search and pagination.
- **`/pix/[id]`**: one PIX with its fact check, which runs automatically when the page opens.
- **`/check`**: paste any story plus the link to its original article.

## How the score works

The check uses Shortly-email-agent's fact-check code (`lib/shortly/`), the same
method as the Shortly newsletter's score.

1. **Evidence.** Reads the original article the PIX was written from. If the stored text
   is thin or is page boilerplate, the full article is fetched from its link, using the page's
   JSON-LD `articleBody` when available. Then finds up to 10 other outlets that
   published the same story: Shortly's own feeds first, then Bing News and Google News
   (`lib/news-search.ts`). "Same story" uses Shortly's title-embedding match.
2. **Claims.** `gpt-4o-mini` splits our headline and story into up to 6 atomic claims
   and grades each against the evidence: supported (1.0), partially supported (0.55),
   not in source (0.15) or contradicted (0).
3. **Source quality.** Grades the original article on attribution, specificity and tone (0–2 each).
4. **Score, computed in code:** 70% × average claim credit + 30% × source quality.
   Any contradicted claim caps the score at 45.
   Labels: Verified ≥ 85, Mostly factual ≥ 65, Mixed ≥ 40, Unverified < 40.

The score measures whether our story matches the reporting. It does not prove the
reporting itself is true, and facts we leave out don't lower it.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Fill in `.env`:

| Variable | What it is |
|---|---|
| `OPENAI_API_KEY` | Runs the fact check (`gpt-4o-mini`) and title embeddings (`text-embedding-3-small`) |
| `PIX_SUPABASE_URL`, `PIX_SUPABASE_SERVICE_ROLE_KEY` | PIX news database (PixAgent). Server-side only, never `NEXT_PUBLIC_` |
| `SHORTLY_SUPABASE_URL`, `SHORTLY_SUPABASE_PUBLISHABLE_KEY` | Shortly-email-agent's **public** key, for other outlets' coverage (read-only, approved articles only) |

Optional, with the same names as in Shortly: `FACT_CHECK_MODEL`, `EMBED_MODEL`, `FACT_CHECK_ENABLED`.

Then open http://localhost:3000.

## Notes

- Fact-check results are cached in memory for 6 hours per PIX. Use **Re-check** for a fresh run.
  The cache resets whenever the server restarts.
- Next.js 16 with Cache Components: PIX data is always read at request time (`connection()` in `lib/pix.ts`).
