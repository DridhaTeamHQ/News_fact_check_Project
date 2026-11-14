import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PixFactCheck } from "@/components/pix-fact-check";
import { PixImage } from "@/components/pix-image";
import { getPixPost } from "@/lib/pix";

export default function PixPage({ params }: PageProps<"/pix/[id]">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All PIX news
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <PixDetail params={params} />
      </Suspense>
    </main>
  );
}

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "";

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

async function PixDetail({ params }: { params: PageProps<"/pix/[id]">["params"] }) {
  const { id } = await params;
  const post = await getPixPost(id);
  if (!post) notFound();

  const paragraphs = (post.body || post.source_text).split(/\n{2,}|\r?\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
      <article>
        <PixImage src={post.image} alt={post.headline} eager size={[1200, 750]} className="aspect-[16/10] w-full rounded-2xl" />
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {post.category && <span className="font-semibold tracking-wide text-primary uppercase">{post.category}</span>}
          <span>{fmtDay(post.published_at)}</span>
        </div>
        <h1 className="mt-2 text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">{post.headline}</h1>
        <div className="mt-4 space-y-3 text-[15px] leading-relaxed">
          {paragraphs.length ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : <p className="text-muted-foreground">No story text.</p>}
        </div>
        {post.source_url && (
          <a
            href={post.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Original source: {hostOf(post.source_url)} <ExternalLink className="size-3.5" />
          </a>
        )}

        {post.cards.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">PIX cards</h2>
            <div className="mt-3 flex snap-x gap-3 overflow-x-auto pb-2">
              {post.cards.map((src, i) => (
                <PixImage key={src} src={src} alt={`PIX card ${i + 1}`} size={[320, 568]} className="aspect-[9/16] w-40 shrink-0 snap-start rounded-lg border" />
              ))}
            </div>
          </div>
        )}
      </article>

      <aside className="lg:sticky lg:top-6">
        <PixFactCheck pixId={post.id} />
      </aside>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]" aria-hidden>
      <div>
        <div className="aspect-[16/10] w-full animate-pulse rounded-xl bg-muted" />
        <div className="mt-5 h-7 w-4/5 animate-pulse rounded bg-muted" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
      <div className="h-48 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
