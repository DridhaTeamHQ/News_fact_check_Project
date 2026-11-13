/* The plain answer a reader wants from a check: is this news true or false?
 *
 * Decided in code, in this order:
 *  1. The checked page is itself a fact-check (it publishes a ClaimReview):
 *     the verdict is that fact-checker's rating of the claim it checked.
 *  2. A fact-checker has checked this story and found it false or misleading.
 *  3. Otherwise, from the claim-by-claim check against other outlets:
 *       False         some claims are contradicted (3+, or 1 in 5 or more)
 *       Partly false  a claim is contradicted
 *       True          nothing contradicted and the score is "verified" (85+)
 *       Mostly true   nothing contradicted, 60%+ of claims found in sources
 *       Unverified    too little of it is reported anywhere else to say.
 * "Unverified" is not "false": a story nobody else has reported may be new,
 * exclusive or made up, and the check can't tell which. */

export type Rating = "false" | "misleading" | "true" | "unclear";

export type VerdictLabel = "true" | "mostly-true" | "partly-false" | "false" | "unverified";

export type Verdict = {
  label: VerdictLabel;
  reason: string; // one plain sentence
  basis: "claims" | "fact-check" | "fact-check-page";
};

type Claim = { claim: string; verdict: "supported" | "partially-supported" | "unsupported" | "contradicted" };

/** A fact-checker's rating word ("False", "Partly False", "Misleading", "Fake",
 * "Mostly True"…) reduced to four values. */
export function ratingOf(word: string): Rating {
  const w = word.toLowerCase();
  if (/mostly true|largely true/.test(w)) return "true";
  if (/partly|partially|half|mislead|missing context|out of context|exaggerat|mixed|cherry/.test(w)) return "misleading";
  if (/false|fake|fabricat|incorrect|wrong|scam|hoax|pants on fire|doctored|altered|edited|morphed|deepfake|ai[- ]generated|baseless|misattribut|no evidence|not true|satire|spoof/.test(w))
    return "false";
  if (/\b(true|correct|accurate|genuine|real|verified|authentic)\b/.test(w)) return "true";
  return "unclear";
}

const quote = (s: string, n = 120) => `“${s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s}”`;

export function decideVerdict(input: {
  scored: boolean;
  score: number | null;
  claims: Claim[];
  /** Fact-checker ratings published on the checked page itself. */
  pageReviews?: { claim: string; rating: string; by: string }[];
  /** Fact-checks of this story found by searching. */
  factChecks?: { by: string; title: string; claim: string; storyIs: Rating }[];
  /** Other outlets found that covered the story. */
  outlets: number;
}): Verdict {
  // 1. The page is a fact-check: its verdict on the claim it checked.
  for (const r of input.pageReviews ?? []) {
    const rating = ratingOf(r.rating);
    if (rating === "unclear") continue;
    const label: VerdictLabel = rating === "false" ? "false" : rating === "misleading" ? "partly-false" : "true";
    return {
      label,
      reason: `This is a fact-check by ${r.by}. It rates the claim ${quote(r.claim)} as ${r.rating}.`,
      basis: "fact-check-page",
    };
  }

  // 2. A fact-checker has found this story false or misleading.
  const debunk = (input.factChecks ?? []).find((f) => f.storyIs === "false");
  if (debunk) {
    return {
      label: "false",
      reason: `${debunk.by} fact-checked this and found it false: ${quote(debunk.claim || debunk.title)}.`,
      basis: "fact-check",
    };
  }
  const misleading = (input.factChecks ?? []).find((f) => f.storyIs === "misleading");

  // 3. From the claim-by-claim check.
  const n = input.claims.length;
  const by = (v: Claim["verdict"]) => input.claims.filter((c) => c.verdict === v);
  const contradicted = by("contradicted");
  const confirmed = by("supported").length + by("partially-supported").length;

  let verdict: Verdict;
  if (!input.scored || n === 0) {
    verdict = {
      label: "unverified",
      reason:
        input.outlets === 0
          ? "No other outlet has reported this story, so it can't be confirmed. It may be new, exclusive or made up."
          : "There wasn't enough checkable detail to confirm or refute this story.",
      basis: "claims",
    };
  } else if (contradicted.length >= 3 || contradicted.length / n >= 0.2) {
    verdict = {
      label: "false",
      reason: `Other outlets report different facts: ${contradicted.length} of ${n} claims are contradicted, including ${quote(contradicted[0].claim)}.`,
      basis: "claims",
    };
  } else if (contradicted.length > 0) {
    verdict = {
      label: "partly-false",
      reason: `Most of it checks out, but other outlets contradict ${contradicted.length === 1 ? "one claim" : `${contradicted.length} claims`}: ${quote(contradicted[0].claim)}.`,
      basis: "claims",
    };
  } else if ((input.score ?? 0) >= 85) {
    verdict = {
      label: "true",
      reason: `Confirmed by other outlets: ${confirmed} of ${n} claims match what they report, and none is contradicted.`,
      basis: "claims",
    };
  } else if (confirmed / n >= 0.6) {
    verdict = {
      label: "mostly-true",
      reason: `${confirmed} of ${n} claims match other outlets and none is contradicted, but ${n - confirmed === 1 ? "one detail" : `${n - confirmed} details`} couldn't be found in any other source.`,
      basis: "claims",
    };
  } else {
    verdict = {
      label: "unverified",
      reason: `Only ${confirmed} of ${n} claims could be found in other outlets' reports. Nothing is contradicted, but most of it can't be confirmed.`,
      basis: "claims",
    };
  }

  if (misleading && (verdict.label === "true" || verdict.label === "mostly-true" || verdict.label === "unverified")) {
    return {
      label: "partly-false",
      reason: `${misleading.by} fact-checked this and found it misleading: ${quote(misleading.claim || misleading.title)}.`,
      basis: "fact-check",
    };
  }
  return verdict;
}
