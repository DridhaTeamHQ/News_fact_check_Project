"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PixImage } from "@/components/pix-image";
import { VerdictPill } from "@/components/verdict";
import type { PixPostSummary } from "@/lib/pix";
import type { VerdictLabel } from "@/lib/verdict";

type State = VerdictLabel | "checking" | "error" | undefined;

/** Two at a time: each check reads dozens of pages and runs several searches. */
const PARALLEL = 2;

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "";

/** PIX cards with each story's True / False verdict: saved verdicts show at
 * once; "Check all" checks the rest on this page. */
export function PixList({ posts, verdicts }: { posts: PixPostSummary[]; verdicts: Record<string, VerdictLabel> }) {
  const [state, setState] = useState<Record<string, State>>(verdicts);
  const [running, setRunning] = useState(false);
  const unchecked = posts.filter((p) => !state[p.id] || state[p.id] === "error");

  async function checkAll() {
    setRunning(true);
    const queue = [...unchecked];
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const id = p.id;
        setState((s) => ({ ...s, [id]: "checking" }));
        try {
          const res = await fetch("/api/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pixId: id }),
          });
          const data = await res.json();
          setState((s) => ({ ...s, [id]: res.ok && data.verdict ? data.verdict.label : "error" }));
        } catch {
          setState((s) => ({ ...s, [id]: "error" }));
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    setRunning(false);
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={checkAll} disabled={running || unchecked.length === 0} variant="outline">
          {running ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          {running
            ? "Checking…"
            : unchecked.length === 0
              ? "All news on this page checked"
              : `Check true or false: ${unchecked.length} news on this page`}
        </Button>
        {running && <span className="text-sm text-muted-foreground">About 30 seconds per story, two at a time.</span>}
      </div>

      <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((p, i) => {
          const v = state[p.id];
          return (
            <li key={p.id}>
              <Link
                href={`/pix/${p.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <PixImage src={p.image} alt="" eager={i < 3} className="aspect-[4/3] w-full" />
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex min-h-5 flex-wrap items-center gap-2">
                    {p.category && (
                      <span className="text-xs font-semibold tracking-wide text-primary uppercase">{p.category}</span>
                    )}
                    {v === "checking" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" /> Checking…
                      </span>
                    ) : v === "error" ? (
                      <span className="text-xs text-muted-foreground">Check failed</span>
                    ) : v ? (
                      <VerdictPill label={v} />
                    ) : null}
                  </div>
                  <h2 className="mt-1 line-clamp-3 font-semibold leading-snug group-hover:underline">{p.headline}</h2>
                  <div className="mt-auto pt-3 text-xs text-muted-foreground">{fmtDay(p.published_at)}</div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
