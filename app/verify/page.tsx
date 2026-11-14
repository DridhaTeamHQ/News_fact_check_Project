import { TextChecker } from "@/components/text-checker";

export const metadata = { title: "Is this news real? · Fact Check Mediator" };

/** Only the chat, on the whole screen: no navigation (it's outside the (site) route group). */
export default function VerifyPage() {
  return (
    <main className="h-dvh">
      <TextChecker />
    </main>
  );
}
