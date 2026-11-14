"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/* Dark / light switch. The theme is the `dark` class on <html> (set before
 * paint by the script in app/layout.tsx) and the choice is kept in
 * localStorage. Both icons are rendered and CSS shows the right one, so the
 * button needs no state and can't mismatch on hydration. */

function toggleTheme() {
  const dark = document.documentElement.classList.toggle("dark");
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {
    // Private mode: the switch still works for this page view.
  }
}

/** `label`: a full-width row with "Light mode" / "Dark mode" next to the icon. */
export function ThemeToggle({ label = false, className }: { label?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Switch between dark and light theme"
      title="Switch theme"
      className={cn(
        "inline-flex shrink-0 items-center gap-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        label ? "h-10 w-full px-3" : "size-9 justify-center",
        className,
      )}
    >
      <Sun className="hidden size-4.5 dark:block" aria-hidden />
      <Moon className="size-4.5 dark:hidden" aria-hidden />
      {label && (
        <>
          <span className="hidden dark:inline">Light mode</span>
          <span className="dark:hidden">Dark mode</span>
        </>
      )}
    </button>
  );
}
