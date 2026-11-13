import "server-only";
import type { FactCheckReport } from "./factcheck";

/* Finished PIX checks, kept in memory for 6 hours so reopening a PIX doesn't
 * search again and the PIX list can show each story's verdict. Held on
 * globalThis so the API route and the list page share one store. Resets when
 * the server restarts. */

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

type Entry = { at: number; report: FactCheckReport };
const g = globalThis as typeof globalThis & { __pixFactChecks?: Map<string, Entry> };
const store = (g.__pixFactChecks ??= new Map<string, Entry>());

export function getCachedCheck(pixId: string): FactCheckReport | null {
  const hit = store.get(pixId);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(pixId);
    return null;
  }
  return hit.report;
}

export function setCachedCheck(pixId: string, report: FactCheckReport): void {
  store.delete(pixId); // re-insert so the newest is last
  store.set(pixId, { at: Date.now(), report });
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
}
