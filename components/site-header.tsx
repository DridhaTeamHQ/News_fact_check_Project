import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-5 text-primary" />
          <span>
            DailyMattr <span className="font-normal text-muted-foreground">· Fact Check</span>
          </span>
        </Link>
        <nav className="flex items-center gap-0.5 text-sm sm:gap-1">
          <Link href="/" className="rounded-md px-2 py-1.5 font-medium whitespace-nowrap hover:bg-muted sm:px-3">
            PIX<span className="hidden sm:inline"> news</span>
          </Link>
          <Link href="/verify" className="rounded-md px-2 py-1.5 font-medium whitespace-nowrap hover:bg-muted sm:px-3">
            <span className="sm:hidden">Message</span>
            <span className="hidden sm:inline">Check a message</span>
          </Link>
          <Link href="/check" className="rounded-md px-2 py-1.5 font-medium whitespace-nowrap hover:bg-muted sm:px-3">
            <span className="sm:hidden">Link</span>
            <span className="hidden sm:inline">Check a news link</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
