"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Link2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FactCheckError, FactCheckProgress, FactReport, useFactCheck } from "@/components/fact-report";

/** "Check a news link": a DailyMattr news link (checked as its PIX) or any
 * news article link (checked against other outlets that published it). */
export function FactChecker() {
  const [url, setUrl] = useState("");
  const { report, error, loading, step, run } = useFactCheck();
  const value = url.trim();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Check a news link</h1>
      <p className="mt-2 text-muted-foreground">
        Paste a DailyMattr news link or any news article link. Every claim is checked against the original article and
        other outlets that published the same news.
      </p>

      <form
        className="mt-6 rounded-2xl border bg-card p-4 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) run({ url: value });
        }}
      >
        <label htmlFor="url" className="text-sm font-medium">
          News link
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="url"
              type="url"
              inputMode="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.dailymattr.com/news/…"
              className="h-11 w-full rounded-xl border bg-background pr-3 pl-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button type="submit" disabled={loading || !value} className="h-11 px-4">
            {loading ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Check
          </Button>
        </div>
      </form>

      <div className="mt-8 space-y-4">
        {loading && <FactCheckProgress step={step} />}
        {error && <FactCheckError message={error} />}
        {report && (
          <>
            <div className="rounded-2xl border bg-card p-4">
              <div className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
                {report.pixId ? "Checked PIX" : "Checked article"}
              </div>
              <p className="mt-1 font-semibold leading-snug">{report.headline}</p>
              {report.pixId && (
                <Link
                  href={`/pix/${report.pixId}`}
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Open this PIX <ArrowRight className="size-3.5" />
                </Link>
              )}
            </div>
            <FactReport report={report} />
          </>
        )}
      </div>
    </div>
  );
}
