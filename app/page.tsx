import { Suspense } from "react";
import { NiaCheck } from "@/components/nia-check";
import { PixCarousel, type PixSlide } from "@/components/pix-carousel";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { dailyMattrUrl, listPixPosts, pixConfigured } from "@/lib/pix";

export const metadata = { title: "Fact check by NIA · DailyMattr" };

const HERO_SLIDES = 14;

/** PIX headlines mark highlighted words with (round) or [square] brackets for
 * the card design; on the site they read as plain text. */
const plain = (headline: string) => headline.replace(/[()[\]]/g, "").replace(/\s+/g, " ").trim();

/** The latest PIX, read at request time (live news). */
async function LatestPix() {
  if (!pixConfigured()) return <p className="text-sm text-white/60">The PIX database is not connected.</p>;
  let slides: PixSlide[] = [];
  try {
    const posts = await listPixPosts("", HERO_SLIDES + 6);
    slides = posts
      .map((p) => ({ p, url: dailyMattrUrl(p) }))
      .filter((x): x is { p: (typeof posts)[number]; url: string } => x.url !== null && x.p.image !== null)
      .slice(0, HERO_SLIDES)
      .map(({ p, url }) => ({
        id: p.id,
        headline: plain(p.headline),
        image: p.image,
        url,
        category: p.category,
        publishedAt: p.published_at,
      }));
  } catch (err) {
    console.error("[home] latest PIX", err);
  }
  if (slides.length === 0) return <p className="text-sm text-white/60">No stories to show right now.</p>;
  return <PixCarousel slides={slides} />;
}

function CarouselSkeleton() {
  return (
    <div className="-mx-5 flex gap-4 overflow-hidden px-5 sm:-mx-10 sm:px-10" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="aspect-[2/3] w-[62vw] max-w-[250px] shrink-0 animate-pulse rounded-[22px] bg-white/[0.06] sm:w-[230px] lg:w-[250px]"
        />
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* Hero: always the dark DailyMattr panel, in both themes */}
        <section id="latest" className="scroll-mt-20 px-2 pt-2 sm:px-4 sm:pt-3">
          <div className="relative overflow-hidden rounded-[28px] border border-transparent bg-[radial-gradient(120%_90%_at_50%_0%,#1c1c1f_0%,#0a0a0b_55%)] text-white dark:border-white/[0.07]">
            <div
              className="pointer-events-none absolute top-1/3 left-1/2 size-[560px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(57_121_255/0.18)_0%,transparent_62%)] blur-[30px]"
              aria-hidden
            />
            <div className="relative mx-auto max-w-7xl px-5 pt-14 pb-10 sm:px-10 sm:pt-20 sm:pb-12">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                <div className="max-w-2xl">
                  <p className="text-[11px] font-semibold tracking-[3px] text-[#6b9aff] uppercase">Today on DailyMattr</p>
                  <h1 className="mt-4 text-[40px] leading-[1.05] font-bold tracking-[-1.5px] sm:text-6xl lg:text-[68px]">
                    The latest <span className="text-[#5c5c62]">in</span> PIX
                  </h1>
                  <p className="mt-4 max-w-lg text-base leading-relaxed text-white/80 sm:text-lg">
                    Fresh stories from our newsroom. Saw something doubtful? Ask NIA to fact-check it below.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2.5">
                  <a
                    href="#fact-check"
                    className="inline-flex h-11 items-center rounded-full bg-white px-5 text-[15px] font-semibold text-[#141417] transition-[transform,background-color] outline-none hover:-translate-y-px hover:bg-[#ececf0] focus-visible:ring-3 focus-visible:ring-[#6b9aff] motion-reduce:hover:translate-y-0"
                  >
                    Fact check a story
                  </a>
                  <a
                    href="https://www.dailymattr.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center rounded-full border border-white/20 px-5 text-[15px] font-semibold text-white transition-colors outline-none hover:border-white/50 hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-[#6b9aff]"
                  >
                    All stories
                  </a>
                </div>
              </div>
              <div className="mt-10 sm:mt-12">
                <Suspense fallback={<CarouselSkeleton />}>
                  <LatestPix />
                </Suspense>
              </div>
            </div>
          </div>
        </section>

        <NiaCheck />
      </main>
      <SiteFooter />
    </>
  );
}
