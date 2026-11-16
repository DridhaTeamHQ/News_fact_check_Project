import { NiaCheck } from "@/components/nia-check";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata = { title: "Fact check by NIA · DailyMattr" };

/** The home page: NIA's fact check is the hero; its result, how it works and
 * the related DailyMattr stories follow (components/nia-check.tsx). */
export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <NiaCheck />
      </main>
      <SiteFooter />
    </>
  );
}
