import { CircleCheck, CircleHelp, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Verdict, VerdictLabel } from "@/lib/verdict";
import { cn } from "@/lib/utils";

/* The plain True / False answer, as a large banner (result pages) or a small
 * pill (PIX list cards). */

export const VERDICT_THEME: Record<VerdictLabel, { word: string; icon: LucideIcon; banner: string; pill: string }> = {
  true: {
    word: "True",
    icon: CircleCheck,
    banner: "border-emerald-600 bg-emerald-50 text-emerald-950 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-100",
    pill: "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950",
  },
  "mostly-true": {
    word: "Mostly true",
    icon: CircleCheck,
    banner: "border-teal-600 bg-teal-50 text-teal-950 dark:border-teal-500 dark:bg-teal-950/50 dark:text-teal-100",
    pill: "bg-teal-600 text-white dark:bg-teal-500 dark:text-teal-950",
  },
  "partly-false": {
    word: "Partly false",
    icon: TriangleAlert,
    banner: "border-amber-500 bg-amber-50 text-amber-950 dark:border-amber-500 dark:bg-amber-950/50 dark:text-amber-100",
    pill: "bg-amber-500 text-amber-950 dark:bg-amber-400",
  },
  false: {
    word: "False",
    icon: CircleX,
    banner: "border-red-600 bg-red-50 text-red-950 dark:border-red-500 dark:bg-red-950/50 dark:text-red-100",
    pill: "bg-red-600 text-white dark:bg-red-500 dark:text-red-950",
  },
  unverified: {
    word: "Unverified",
    icon: CircleHelp,
    banner: "border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100",
    pill: "bg-zinc-600 text-white dark:bg-zinc-300 dark:text-zinc-900",
  },
};

export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const t = VERDICT_THEME[verdict.label];
  const Icon = t.icon;
  // A fact-check page's verdict is about the claim it checks, not the page.
  const subject = verdict.basis === "fact-check-page" ? "The claim" : "This news";
  return (
    <section className={cn("rounded-xl border-2 p-5 sm:p-6", t.banner)} aria-label={`Verdict: ${t.word}`}>
      <div className="flex items-start gap-4">
        <Icon className="mt-0.5 size-9 shrink-0" aria-hidden />
        <div className="min-w-0">
          <div className="text-xs font-bold tracking-wider uppercase opacity-80">Verdict</div>
          <div className="text-2xl font-bold tracking-tight sm:text-3xl">
            {subject} is {t.word.toLowerCase()}
          </div>
          <p className="mt-2 text-[15px] leading-relaxed">{verdict.reason}</p>
        </div>
      </div>
    </section>
  );
}

export function VerdictPill({ label, className }: { label: VerdictLabel; className?: string }) {
  const t = VERDICT_THEME[label];
  const Icon = t.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", t.pill, className)}>
      <Icon className="size-3.5" aria-hidden />
      {t.word}
    </span>
  );
}
