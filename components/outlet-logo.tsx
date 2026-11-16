"use client";

import { useState } from "react";
import { logoSite } from "@/lib/outlets";
import { cn } from "@/lib/utils";

/* A news outlet's or fact-checker's logo (its site icon), on a small white
 * tile so every logo reads the same in light and dark mode. The site is the
 * article's own, or for a Google News link the one its outlet name belongs
 * to (lib/outlets.ts). Until the logo arrives, and when there is none, the
 * tile shows the outlet's first letter. */

/** Google's site-icon service: only the outlet's public website is sent. */
const iconUrl = (site: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=64`;

export function OutletLogo({
  url,
  name,
  className,
}: {
  url: string | null | undefined;
  name: string;
  /** Size and shape of the tile, e.g. "size-9 rounded-[10px]". */
  className?: string;
}) {
  const site = logoSite(url, name);
  const [state, setState] = useState<{ site: string; ok: boolean } | null>(null);
  const loaded = site !== null && state?.site === site && state.ok;
  const failed = site !== null && state?.site === site && !state.ok;
  const letter = name.trim().slice(0, 1) || "•";

  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden font-bold uppercase transition-colors duration-300",
        loaded
          ? "bg-white ring-1 ring-black/[0.06] dark:ring-white/10"
          : "bg-muted text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      {!loaded && <span className="text-[0.62em] leading-none">{letter}</span>}
      {site && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={site}
          src={iconUrl(site)}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(e) =>
            // A 1-2 px image is the service's "no icon" answer: keep the letter.
            setState({ site, ok: e.currentTarget.naturalWidth > 2 })
          }
          onError={() => setState({ site, ok: false })}
          className={cn(
            "absolute size-[72%] object-contain transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </span>
  );
}
