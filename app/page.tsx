import { Suspense } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { PixImage } from "@/components/pix-image";
import { listPixPage, pixConfigured } from "@/lib/pix";

const PAGE_SIZE = 12;

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">PIX news</h1>
      <p className="mt-1 text-muted-foreground">Open any PIX to check whether it&apos;s true, with its fact score and sources.</p>
      <Suspense fallback={<GridSkeleton />}>
        <PixGrid searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "";

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
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Search PIX headlines…"
            className="h-10 w-full rounded-lg border bg-background pr-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.posts.map((p, i) => (
            <li key={p.id}>
              <Link
                href={`/pix/${p.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <PixImage src={p.image} alt="" eager={i < 3} className="aspect-[4/3] w-full" />
                <div className="flex flex-1 flex-col p-4">
                  {p.category && (
                    <span className="text-xs font-semibold tracking-wide text-primary uppercase">{p.category}</span>
                  )}
                  <h2 className="mt-1 line-clamp-3 font-semibold leading-snug group-hover:underline">{p.headline}</h2>
                  <div className="mt-auto pt-3 text-xs text-muted-foreground">{fmtDay(p.published_at)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <Pagination page={data.page} pageCount={data.pageCount} href={href} />
      </div>
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 rounded-xl border bg-muted/40 p-6 text-sm text-muted-foreground">{children}</div>;
}

function GridSkeleton() {
  return (
    <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-xl border bg-card">
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
