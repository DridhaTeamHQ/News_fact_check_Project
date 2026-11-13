"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FactCheckError, FactCheckProgress, FactReport, useFactCheck } from "@/components/fact-report";

/** "Check any news": our story text + (optionally) the original article link. */
export function FactChecker() {
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const { report, error, loading, step, run } = useFactCheck();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Check any news</h1>
      <p className="mt-2 text-muted-foreground">
        Paste a story and the link to the article it was written from. Every claim is checked against that article and other
        outlets in Shortly&apos;s feeds, using Shortly&apos;s fact-check method.
      </p>

      <form
        className="mt-6 space-y-4 rounded-xl border bg-card p-4 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) run({ text: text.trim(), sourceUrl: sourceUrl.trim() || undefined });
        }}
      >
        <div>
          <label htmlFor="news" className="text-sm font-medium">
            Our story: headline on the first line, then the text
          </label>
          <textarea
            id="news"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder={"Headline\n\nThe news text…"}
            className="mt-2 w-full rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label htmlFor="source" className="text-sm font-medium">
            Original article link <span className="font-normal text-muted-foreground">(recommended)</span>
          </label>
          <input
            id="source"
            type="url"
            inputMode="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://www.example.com/news/story"
            className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={loading || !text.trim()}>
            {loading ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Check this news
          </Button>
        </div>
      </form>

      <div className="mt-8 space-y-4">
        {loading && <FactCheckProgress step={step} />}
        {error && <FactCheckError message={error} />}
        {report && <FactReport report={report} />}
      </div>
    </div>
  );
}
