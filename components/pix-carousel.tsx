"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PixImage } from "@/components/pix-image";
import { cn } from "@/lib/utils";

/* The hero's PIX carousel: the latest DailyMattr stories as tall 2:3 poster
 * cards (PIX images are 2:3 posters). It moves on by one card every few
 * seconds, and stops while the reader hovers, focuses or has asked for
 * reduced motion. Each card opens the story on dailymattr.com. */

export type PixSlide = {
  id: string;
  headline: string;
  image: string | null;
  url: string;
  category: string | null;
  publishedAt: string | null;
};

const AUTOPLAY_MS = 4500;

/** "12 min ago", "3 h ago", "2 d ago". */
function ago(iso: string | null): string | null {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(mins) || mins < 0) return null;
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / (24 * 60))} d ago`;
}

const noop = () => () => {};

/** Move the track by about one card (or a page of cards); past the end, back
 * to the start. */
function step(el: HTMLElement | null, dir: 1 | -1, page = false) {
  if (!el) return;
  const card = el.querySelector("li");
  const width = card ? card.getBoundingClientRect().width + 16 : 260;
  const by = page ? Math.max(width, Math.floor(el.clientWidth / width) * width) : width;
  const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
  if (dir === 1 && atEnd) el.scrollTo({ left: 0, behavior: "smooth" });
  else el.scrollBy({ left: dir * by, behavior: "smooth" });
}

export function PixCarousel({ slides }: { slides: PixSlide[] }) {
  const track = useRef<HTMLUListElement>(null);
  const [paused, setPaused] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: false });
  // "x min ago" needs the reader's clock: only after hydration.
  const mounted = useSyncExternalStore(noop, () => true, () => false);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () =>
      setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      if (!document.hidden) step(track.current, 1);
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [paused]);

  if (slides.length === 0) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <ul
        ref={track}
        aria-label="Latest PIX stories"
        className="scrollbar-none -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-2 sm:-mx-10 sm:scroll-px-10 sm:px-10"
      >
        {slides.map((s, i) => {
          const when = mounted ? ago(s.publishedAt) : null;
          return (
            <li key={s.id} className="w-[62vw] max-w-[250px] shrink-0 snap-start sm:w-[230px] lg:w-[250px]">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative block aspect-[2/3] overflow-hidden rounded-[22px] border border-white/10 bg-[#141417] shadow-[0_30px_70px_-30px_rgb(0_0_0/0.8)] outline-none focus-visible:ring-3 focus-visible:ring-[#6b9aff]"
              >
                <PixImage
                  src={s.image}
                  alt=""
                  eager={i < 5}
                  size={[500, 750]}
                  className="size-full object-top transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none"
                />
                <span className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/55 to-transparent" />
                {(s.category || when) && (
                  <span className="absolute top-3 left-3 rounded-full bg-white/92 px-2.5 py-1 text-[10.5px] font-bold tracking-[0.08em] text-[#141417] uppercase shadow-[0_2px_8px_rgb(10_10_11/0.12)] backdrop-blur-sm">
                    {s.category ?? when}
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 p-4">
                  <span className="line-clamp-3 text-[15px] leading-snug font-semibold tracking-[-0.01em] text-white">
                    {s.headline}
                  </span>
                  <span className="mt-2 block text-xs font-semibold text-[#8db4ff] group-hover:underline">
                    Read on DailyMattr →
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex items-center justify-end gap-2">
        {(
          [
            [-1, "Previous stories", ChevronLeft, edges.start],
            [1, "Next stories", ChevronRight, false],
          ] as const
        ).map(([dir, label, Icon, disabled]) => (
          <button
            key={label}
            type="button"
            onClick={() => step(track.current, dir, true)}
            disabled={disabled}
            aria-label={label}
            title={label}
            className={cn(
              "flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition-colors outline-none hover:border-white/40 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#6b9aff] disabled:opacity-35",
            )}
          >
            <Icon className="size-5" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
