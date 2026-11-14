import { Suspense } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { NavLinks, SiteNav } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme-toggle";

/* The app's navigation: a top bar on phones, a sidebar on wide screens. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-sidebar px-3 lg:h-dvh lg:w-60 lg:flex-col lg:items-stretch lg:gap-0 lg:border-r lg:border-b-0 lg:p-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring lg:px-1.5 lg:py-2"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-4.5" aria-hidden />
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-semibold">DailyMattr</span>
            <span className="block text-xs text-muted-foreground">Fact Check</span>
          </span>
        </Link>
        <div className="hidden lg:block">
          <ThemeToggle className="text-muted-foreground hover:text-foreground" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 lg:mt-5 lg:flex-col">
        <Suspense fallback={<NavLinks path={null} />}>
          <SiteNav />
        </Suspense>
      </div>

      <div className="lg:hidden">
        <ThemeToggle className="text-muted-foreground hover:text-foreground" />
      </div>
    </header>
  );
}
