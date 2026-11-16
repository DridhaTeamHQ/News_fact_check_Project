"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* Fades its content up the first time it scrolls into view (.nia-reveal in
 * app/globals.css). The server renders it visible; only once the page runs
 * does it hide what is still below the screen, until the reader gets there.
 * So without JavaScript, or if the page never finishes loading, nothing stays
 * hidden, and nothing on screen ever blinks out. */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li";
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already on screen
    el.dataset.pending = "";
    const show = () => {
      delete el.dataset.pending;
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        // On screen, or already scrolled past (a fast fling, a jump to the footer).
        if (entry.isIntersecting || entry.boundingClientRect.top <= 0) show();
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    // Backup for browsers that throttle the observer (power saving, background
    // tabs): plain scroll events still arrive.
    const onScroll = () => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.95) show();
    };
    io.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      delete el.dataset.pending;
    };
  }, []);
  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={cn("nia-reveal", className)}
      style={delay ? ({ "--nia-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}
