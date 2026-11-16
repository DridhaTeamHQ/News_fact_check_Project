/* The footer, after dailymattr.com's: a mist-grey sheet (near-black in dark
 * mode), the wordmark and links, and the logo again as a giant signature. */

const COLUMNS = [
  {
    title: "DAILYMATTR",
    links: [
      { label: "dailymattr.com", href: "https://www.dailymattr.com/" },
      { label: "About", href: "https://www.dailymattr.com/about/" },
      { label: "Editorial guidelines", href: "https://www.dailymattr.com/editorialguidelines/" },
    ],
  },
  {
    title: "GET THE APP",
    links: [
      { label: "Google Play", href: "https://play.google.com/store/apps/details?id=com.dailymattr" },
      { label: "App Store", href: "https://apps.apple.com/in/app/dailymattr/id6791996138" },
    ],
  },
  {
    title: "HELP",
    links: [
      { label: "Support", href: "https://www.dailymattr.com/support/" },
      { label: "Privacy policy", href: "https://www.dailymattr.com/privacypolicy/" },
      { label: "Terms", href: "https://www.dailymattr.com/termsandconditions/" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 overflow-hidden bg-[#e5e4e8] pt-16 dark:bg-[#0d0d0f]">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 sm:px-8 md:flex-row md:justify-between">
        <div className="max-w-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/dailymattr-logo.svg" alt="DailyMattr" width={156} height={32} className="h-8 w-auto" />
          <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
            Short news, video and audio explainers. NIA checks forwards and news links against trusted sources.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-12 gap-y-8 sm:grid-cols-3">
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h2 className="mb-4 text-xs font-semibold tracking-[1.5px] text-[#97979e]">{c.title}</h2>
              <ul className="space-y-3">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium hover:underline focus-visible:underline"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <p className="mx-auto mt-12 max-w-7xl px-5 text-sm font-medium text-muted-foreground sm:px-8">
        © <span className="font-bold text-primary">Dridha Technologies</span> Private Limited
      </p>
      <div className="mt-12 -mb-[1.5vw] flex justify-center" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/dailymattr-logo.svg" alt="" width={156} height={32} className="w-[min(92vw,1400px)] opacity-90" />
      </div>
    </footer>
  );
}
