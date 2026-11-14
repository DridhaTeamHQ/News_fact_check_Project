import { SiteHeader } from "@/components/site-header";

/* Pages in the app shell: the navigation (a top bar on phones, a sidebar on
 * wide screens) and the page next to it. The chat (app/verify) sits outside
 * this group: it is only the chat, on the whole screen. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:flex-row">
      <SiteHeader />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
