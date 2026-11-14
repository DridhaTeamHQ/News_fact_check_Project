import { Suspense } from "react";
import { Search } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { PixList } from "@/components/pix-list";
import { getCachedCheck } from "@/lib/check-cache";
import { listPixPage, pixConfigured } from "@/lib/pix";
import type { VerdictLabel } from "@/lib/verdict";

/** Verdicts of PIX already checked in the last 6 hours. */
function savedVerdicts(ids: string[]): Record<string, VerdictLabel> {
  const out: Record<string, VerdictLabel> = {};
  for (const id of ids) {
    const label = getCachedCheck(id)?.verdict?.label;
    if (label) out[id] = label;
  }
  return out;
}

const PAGE_SIZE = 12;

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">PIX news</h1>
      <p className="mt-1 text-muted-foreground">See whether each PIX is true or false. Open one for its full check, or check every story on a page at once.</p>
      <Suspense fallback={<GridSkeleton />}>
        <PixGrid searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function PixGrid({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const sp = await searchParams;
  const q = first(sp.q).trim();
  const page = Math.max(1, Number.parseInt(first(sp.page), 10) || 1);

  if (!pixConfigured()) {
    return <Notice>PIX database is not connected. Add PIX_SUPABASE_URL and PIX_SUPABASE_SERVICE_ROLE_KEY to .env.</Notice>;
  }

  let data: Awaited<ReturnType<typeof listPixPage>>;
  try {
    data = await listPixPage({ page, pageSize: PAGE_SIZE, query: q });
  } catch (err) {
    return <Notice>{(err as Error).message}</Notice>;
  }

  const href = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form action="/" className="relative w-full sm:max-w-md">
          <label htmlFor="q" className="sr-only">
            Search PIX headlines
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Search PIX headlines…"
            className="h-11 w-full rounded-xl border bg-card pr-3 pl-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </form>
        <p className="text-sm text-muted-foreground tabular-nums">
          {data.total.toLocaleString("en-IN")} {q ? `results for “${q}”` : "published PIX"} · page {data.page} of{" "}
          {data.pageCount.toLocaleString("en-IN")}
        </p>
      </div>

      {data.posts.length === 0 ? (
        <Notice>{q ? `No PIX match “${q}”.` : "No published PIX yet."}</Notice>
      ) : (
        <PixList key={`${q}|${data.page}`} posts={data.posts} verdicts={savedVerdicts(data.posts.map((p) => p.id))} />
      )}

      <div className="mt-8">
        <Pagination page={data.page} pageCount={data.pageCount} href={href} />
      </div>
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 rounded-2xl border bg-muted/40 p-6 text-sm text-muted-foreground">{children}</div>;
}

function GridSkeleton() {
  return (
    <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-2xl border bg-card">
          <div className="aspect-[4/3] w-full animate-pulse bg-muted" />
          <div className="space-y-2 p-4">
            <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
