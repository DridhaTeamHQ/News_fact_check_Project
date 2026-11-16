import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

/* The site's top bar, after dailymattr.com's nav: frosted white (dark glass in
 * dark mode), the DailyMattr wordmark with a small blue tagline, pill links
 * and the blue "Get the app" button. */

const LINKS = [
  { href: "/#fact-check", label: "Fact check" },
  { href: "/#how", label: "How it works" },
  { href: "/chat", label: "Chat with NIA" },
];

export function SiteHeader() {
  return (
    <header className="nia-header sticky top-0 z-50 border-b border-transparent bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:h-[70px] sm:px-8">
        <Link
          href="/"
          className="flex shrink-0 flex-col items-center gap-0.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="DailyMattr fact check, home"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/dailymattr-logo.svg" alt="" width={156} height={32} className="h-7 w-auto sm:h-8" />
          <span className="text-[7.5px] leading-3 font-medium tracking-[1px] text-primary uppercase">
            Fact check by NIA
          </span>
        </Link>

        <nav className="hidden items-center gap-1.5 md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeToggle className="text-muted-foreground hover:text-foreground" />
          <Link
            href="/chat"
            className="rounded-full px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          >
            Chat
          </Link>
          <a
            href="https://www.dailymattr.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-9 items-center rounded-full bg-primary px-4 min-[420px]:inline-flex text-sm font-semibold whitespace-nowrap text-primary-foreground transition-[transform,background-color] outline-none hover:-translate-y-px hover:bg-[var(--brand-blue-hover)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:hover:translate-y-0"
          >
            Get the app
          </a>
        </div>
      </div>
    </header>
  );
}
