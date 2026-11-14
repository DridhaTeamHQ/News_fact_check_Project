import { TextChecker } from "@/components/text-checker";

export const metadata = { title: "Is this news real? · Fact Check Mediator" };

/** The whole app: the chat with NIA, on the whole screen. */
export default function HomePage() {
  return (
    <main className="h-dvh">
      <TextChecker />
    </main>
  );
}
