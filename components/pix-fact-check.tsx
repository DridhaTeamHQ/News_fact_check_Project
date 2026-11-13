"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FactCheckError, FactCheckProgress, FactReport, fmtDate, useFactCheck } from "@/components/fact-report";

/** Runs the fact check as soon as a PIX is opened. The server caches the
 * result per PIX for 6 hours, so reopening it doesn't search again. */
export function PixFactCheck({ pixId }: { pixId: string }) {
  const { report, error, loading, step, run } = useFactCheck();

  useEffect(() => {
    run({ pixId });
  }, [pixId, run]);

  return (
    <section aria-labelledby="fact-check-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="fact-check-heading" className="text-lg font-semibold">
          Fact check
        </h2>
        {(report || error) && !loading && (
          <Button size="sm" variant="outline" onClick={() => run({ pixId, force: true })}>
            <RefreshCw /> Re-check
          </Button>
        )}
      </div>
      {loading && <FactCheckProgress step={step} />}
      {error && <FactCheckError message={error} />}
      {report && (
        <>
          {report.cached && (
            <p className="text-xs text-muted-foreground">Saved result from {fmtDate(report.checked_at)}. Use Re-check for a fresh search.</p>
          )}
          <FactReport report={report} />
        </>
      )}
    </section>
  );
}
