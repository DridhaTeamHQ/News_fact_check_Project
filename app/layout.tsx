import type { Metadata } from "next";
import { Be_Vietnam_Pro, Geist_Mono } from "next/font/google";
import "./globals.css";

// DailyMattr's typeface (dailymattr.com). Not a variable font: weights listed.
const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-be-vietnam-pro",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fact Check Mediator",
  description: "Paste a message or a news link and find out if the news is true or false.",
};

/* Dark is the default theme. A reader who picked light (components/theme-toggle.tsx)
 * has it saved in localStorage; this runs before the first paint so the page
 * never flashes dark first. */
const THEME_SCRIPT = `(function(){try{if(localStorage.getItem("theme")==="light")document.documentElement.classList.remove("dark")}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // globals.css scrolls smoothly; this tells Next.js to jump on route changes
      data-scroll-behavior="smooth"
      className={`${beVietnamPro.variable} ${geistMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
