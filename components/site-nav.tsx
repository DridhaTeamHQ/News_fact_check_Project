"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Link2, MessagesSquare, Newspaper, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS: { href: string; label: string; short: string; icon: LucideIcon; active: (path: string) => boolean }[] = [
  { href: "/", label: "PIX news", short: "News", icon: Newspaper, active: (p) => p === "/" || p.startsWith("/pix") },
  { href: "/verify", label: "Ask NIA", short: "Chat", icon: MessagesSquare, active: (p) => p.startsWith("/verify") },
  { href: "/check", label: "Check a news link", short: "Link", icon: Link2, active: (p) => p.startsWith("/check") },
];

/** The navigation links: a row in the top bar on phones, a column in the
 * sidebar on wide screens. `path` null: no link is marked as the current page. */
export function NavLinks({ path }: { path: string | null }) {
  return (
    <nav className="flex min-w-0 flex-1 items-center justify-end gap-1 lg:flex-none lg:flex-col lg:items-stretch lg:justify-start">
      {LINKS.map(({ href, label, short, icon: Icon, active }) => {
        const current = path !== null && active(path);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-10 lg:gap-3 lg:px-3",
              current
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4.5 shrink-0" aria-hidden />
            <span className="lg:hidden">{short}</span>
            <span className="hidden lg:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Needs a Suspense boundary: on pages with a dynamic segment (/pix/[id]) the
 * path isn't known while prerendering. */
export function SiteNav() {
  return <NavLinks path={usePathname()} />;
}
