/* News outlets and fact-checkers we know by website. Shared by the checker
 * (lib/factcheck.ts: names for outlets, and which count as trusted) and the
 * page (components/outlet-logo.tsx: each source's logo). No server-only code. */

/** Website → outlet name. A subdomain matches its site (news.bbc.co.uk → BBC). */
export const OUTLETS: Record<string, string> = {
  "timesofindia.indiatimes.com": "Times of India",
  "economictimes.indiatimes.com": "Economic Times",
  "hindustantimes.com": "Hindustan Times",
  "indianexpress.com": "Indian Express",
  "thehindu.com": "The Hindu",
  "ndtv.com": "NDTV",
  "sports.ndtv.com": "NDTV Sports",
  "ndtvprofit.com": "NDTV Profit",
  "news18.com": "News18",
  "moneycontrol.com": "Moneycontrol",
  "livemint.com": "Mint",
  "business-standard.com": "Business Standard",
  "newindianexpress.com": "New Indian Express",
  "telegraphindia.com": "The Telegraph",
  "deccanherald.com": "Deccan Herald",
  "thehindubusinessline.com": "BusinessLine",
  "financialexpress.com": "Financial Express",
  "indiatoday.in": "India Today",
  "reuters.com": "Reuters",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC",
  "aljazeera.com": "Al Jazeera",
  "dawn.com": "Dawn",
  "timesnownews.com": "Times Now",
  "wionews.com": "WION",
  "firstpost.com": "Firstpost",
  "abplive.com": "ABP Live",
  "freepressjournal.in": "Free Press Journal",
  "news.abplive.com": "ABP Live",
  "zeenews.india.com": "Zee News",
  "republicworld.com": "Republic World",
  "theprint.in": "ThePrint",
  "scroll.in": "Scroll",
  "thewire.in": "The Wire",
  "outlookindia.com": "Outlook",
  "dnaindia.com": "DNA",
  "tribuneindia.com": "The Tribune",
  "thequint.com": "The Quint",
  "cnbctv18.com": "CNBC-TV18",
  "businesstoday.in": "Business Today",
  "techcrunch.com": "TechCrunch",
  "apnews.com": "AP News",
  "theguardian.com": "The Guardian",
  "nytimes.com": "The New York Times",
  "cnn.com": "CNN",
  "bloomberg.com": "Bloomberg",
  "inc42.com": "Inc42",
};

/** Fact-checkers and other outlets that sources name but that have no entry
 * above (keys: the name, lowercased, letters and digits only). */
const MORE_SITES: Record<string, string> = {
  factly: "factly.in",
  boom: "boomlive.in",
  boomlive: "boomlive.in",
  altnews: "altnews.in",
  pib: "pib.gov.in",
  pibfactcheck: "pib.gov.in",
  newschecker: "newschecker.in",
  vishvasnews: "vishvasnews.com",
  factcrescendo: "factcrescendo.com",
  newsmeter: "newsmeter.in",
  newsmobile: "newsmobile.in",
  webqoof: "thequint.com",
  leadstories: "leadstories.com",
  snopes: "snopes.com",
  politifact: "politifact.com",
  fullfact: "fullfact.org",
  afp: "afp.com",
  afpfactcheck: "factcheck.afp.com",
  reutersfactcheck: "reuters.com",
  indiatodayfactcheck: "indiatoday.in",
  etnow: "etnownews.com",
  indiacom: "india.com",
  dailymattr: "dailymattr.com",
  thelogicalindian: "thelogicalindian.com",
  dynamitenews: "dynamitenews.com",
  northeastlive: "northeastlivetv.com",
  economictimes: "economictimes.indiatimes.com",
  timesofindia: "timesofindia.indiatimes.com",
  toi: "timesofindia.indiatimes.com",
};

const nameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]/g, "");

/** Outlet name → its website, from both tables. */
const SITE_BY_NAME: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [site, name] of Object.entries(OUTLETS)) out[nameKey(name)] ??= site;
  return { ...out, ...MORE_SITES };
})();

/** Links that only pass through to the article (their own logo would be wrong). */
const REDIRECTORS = /(^|\.)(news\.google\.com|google\.com|bing\.com|msn\.com|t\.co|bit\.ly)$/;

/** The website whose logo stands for a source: the article's own site, or,
 * for a redirect link (Google News) or none, the site its outlet name
 * belongs to. Null when neither is known. */
export function logoSite(url: string | null | undefined, name: string): string | null {
  let host = "";
  try {
    host = url ? new URL(url).hostname.toLowerCase().replace(/^(www|m|amp)\./, "") : "";
  } catch {
    host = "";
  }
  if (host && !REDIRECTORS.test(host)) return host;
  const key = nameKey(name);
  if (SITE_BY_NAME[key]) return SITE_BY_NAME[key];
  // A name that is itself a website ("TheWire.in", "India.com").
  const trimmed = name.trim().toLowerCase();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(trimmed)) return trimmed.replace(/^www\./, "");
  // The longest known outlet name inside it ("PIB Fact Check" → pib).
  const hit = Object.keys(SITE_BY_NAME)
    .filter((k) => k.length >= 3 && key.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? SITE_BY_NAME[hit] : null;
}
