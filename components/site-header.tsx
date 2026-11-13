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
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/" className="rounded-md px-3 py-1.5 font-medium hover:bg-muted">
            PIX news
          </Link>
          <Link href="/check" className="rounded-md px-3 py-1.5 font-medium hover:bg-muted">
            Check any news
          </Link>
        </nav>
      </div>
    </header>
  );
}
