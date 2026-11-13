import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Page numbers to show: first, last, and a window around the current page. */
function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

export function Pagination({ page, pageCount, href }: { page: number; pageCount: number; href: (page: number) => string }) {
  if (pageCount <= 1) return null;
  const item = "flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-sm font-medium tabular-nums";
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={href(page - 1)} className={cn(item, "hover:bg-muted")} rel="prev">
          <ChevronLeft className="size-4" /> <span className="sr-only sm:not-sr-only sm:ml-1">Prev</span>
        </Link>
      ) : (
        <span className={cn(item, "pointer-events-none opacity-40")} aria-hidden>
          <ChevronLeft className="size-4" />
        </span>
      )}
      {pageWindow(page, pageCount).map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-muted-foreground">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={href(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(item, p === page ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {p}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link href={href(page + 1)} className={cn(item, "hover:bg-muted")} rel="next">
          <span className="sr-only sm:not-sr-only sm:mr-1">Next</span> <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span className={cn(item, "pointer-events-none opacity-40")} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
