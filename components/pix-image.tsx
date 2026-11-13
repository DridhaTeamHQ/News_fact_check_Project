"use client";

import { useState } from "react";
import { Newspaper } from "lucide-react";
import { cn } from "@/lib/utils";

/* PIX photos in Supabase storage are full-size PNGs (often 2+ MB). Supabase's
 * image renderer serves a resized WebP instead (~30–70 KB).
 * Width AND height must both be given: with width alone the renderer crops a
 * full-height strip instead of scaling the photo down. */
function sized(src: string, [width, height]: [number, number]): string {
  if (!src.includes("/storage/v1/object/public/")) return src;
  const url = src.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  return `${url}${url.includes("?") ? "&" : "?"}width=${width}&height=${height}&resize=cover&quality=70`;
}

/** PIX photos come from several hosts (Supabase storage, publishers), so a
 * plain <img> with lazy loading and a placeholder if the photo fails. */
export function PixImage({
  src,
  alt,
  className,
  eager,
  size = [600, 450],
}: {
  src: string | null;
  alt: string;
  className?: string;
  eager?: boolean;
  /** Pixel box to fetch; match the displayed aspect ratio (default 4:3). */
  size?: [number, number];
}) {
  const [failed, setFailed] = useState(false);
  const [useOriginal, setUseOriginal] = useState(false);
  if (!src || failed) {
    return (
      <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)} aria-hidden>
        <Newspaper className="size-8 opacity-50" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={useOriginal ? src : sized(src, size)}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      // If the resizer fails, fall back to the original once, then a placeholder.
      onError={() => (useOriginal || sized(src, size) === src ? setFailed(true) : setUseOriginal(true))}
      // Most PIX photos are tall portraits; keep faces (top third) in the crop.
      className={cn("bg-muted object-cover object-[50%_25%]", className)}
    />
  );
}
