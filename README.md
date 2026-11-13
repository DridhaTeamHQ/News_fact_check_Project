# News Fact Check

Checks whether DailyMattr's PIX news stories match what the original article and
other outlets reported, and gives each story a fact score with its sources.

- **`/`**: all published PIX news with photos, search and pagination.
- **`/pix/[id]`**: one PIX with its fact check, which runs automatically when the page opens.
- **`/check`**: paste a news link. A DailyMattr link is checked as its PIX; any other article is checked against other outlets that published the same news.

## True or false: the verdict

Every check ends with a plain verdict (`lib/verdict.ts`), decided in code in this order:

1. **The page is a fact-check** (it publishes schema.org `ClaimReview`, as BOOM, Alt News,
   Factly, AFP and others do): the verdict is that fact-checker's rating of the claim it
   checked, e.g. "The claim is false".
2. **A fact-checker has checked this story** (`lib/fact-checks.ts` searches Bing and Google
   News for "<headline> fact check", keeps known fact-checkers, reads their published rating
   and asks the model whether it is the same claim): if they found it false, the verdict is
   **False**; if misleading, **Partly false**.
3. **Otherwise, from the claim-by-claim check** below:
   - **False:** 3 or more claims, or 1 in 5, are contradicted by other outlets.
   - **Partly false:** a claim is contradicted.
   - **True:** nothing is contradicted and the fact score is 85 or more.
   - **Mostly true:** nothing is contradicted and 60% or more of the claims are found in other sources.
   - **Unverified:** too little of the story is reported anywhere else to say. This is not
     the same as false: a story no one else has reported may be new, exclusive or made up.

The PIX list shows the verdict of every story checked in the last 6 hours, and
**Check true or false** checks the rest of the page (two at a time, under a minute each).

## How the score works

The checker (`lib/shortly/fact-check.ts`) started as Shortly-email-agent's fact-check
code. Tests with deliberately falsified stories showed that version was too lenient
(a story with a wrong figure or an invented fact could still score "Verified"), so
it is now stricter: method `source-grounding-v2`.

1. **Evidence.** Reads the original article the PIX was written from. If the stored text
   is thin or is page boilerplate, the full article is fetched from its link (retrying quick
   failures), using the page's JSON-LD `articleBody` when available. Then finds up to 10
   other outlets that published the same story: Shortly's own feeds first, then Bing News
   and Google News (`lib/news-search.ts`). "Same story" uses Shortly's title-embedding match.
2. **Claims.** One model call splits our headline and story into up to 20 atomic claims
   *without seeing the source*, so it cannot quietly correct a wrong figure.
3. **Verdicts.** A second call grades every claim against the evidence (up to 10,000
   characters of the source, plus the other outlets) and must quote the source's words
   for each verdict: supported, partially supported, not in source, or contradicted.
   It also grades the source on attribution, specificity and tone (0–2 each).
4. **Second look.** Claims not yet confirmed are graded again with more evidence: the
   other outlets' full articles, and a news search for each of those claims. From every
   article read, the sentences about those claims are passed on. A fact missing from the
   first articles is usually reported somewhere else; an invented one is not. The same
   call double-checks contradictions: one stands only if a source states its own,
   different value. A detail the sources never mention is not a contradiction.
5. **Checks in code.** A verdict whose quote is not in the evidence doesn't count. A claim
   with a figure the evidence never states can't be "supported" (units are understood:
   1.3 lakh = 130,000).
6. **Score, computed in code:** average claim credit × (80 + 20 × source quality).
   Credit: supported 1, partially supported 0.5, not in source 0, contradicted 0.
   Any contradicted claim caps the score at 45. If more than 1 in 10 claims (or their
   figures) are found in no source, the score caps at 84, below Verified.
   Labels: Verified ≥ 85, Mostly factual ≥ 65, Mixed ≥ 40, Unverified < 40.

A check reads up to a few dozen pages and makes four or five model calls, so it takes
about 25–50 seconds.

The score measures whether our story matches the reporting. It does not prove the
reporting itself is true, and facts we leave out don't lower it. The verdicts come from
a language model, so an individual verdict can be wrong: the claim-by-claim breakdown
shows the source's words next to each claim so an editor can check it.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Fill in `.env`:

| Variable | What it is |
|---|---|
| `OPENAI_API_KEY` | Runs the fact check and title embeddings (`text-embedding-3-small`) |
| `OPENAI_MODEL` | Optional. Model for the fact check (default `gpt-4o-mini`); `FACT_CHECK_MODEL` overrides it |
| `PIX_SUPABASE_URL`, `PIX_SUPABASE_SERVICE_ROLE_KEY` | PIX news database (PixAgent). Server-side only, never `NEXT_PUBLIC_` |
| `SHORTLY_SUPABASE_URL`, `SHORTLY_SUPABASE_PUBLISHABLE_KEY` | Shortly-email-agent's **public** key, for other outlets' coverage (read-only, approved articles only) |

Also optional, with the same names as in Shortly: `FACT_CHECK_MODEL`, `EMBED_MODEL`, `FACT_CHECK_ENABLED`.

Then open http://localhost:3000.

## Notes

- Fact-check results are cached in memory for 6 hours per PIX. Use **Re-check** for a fresh run.
  The cache resets whenever the server restarts.
- Next.js 16 with Cache Components: PIX data is always read at request time (`connection()` in `lib/pix.ts`).
