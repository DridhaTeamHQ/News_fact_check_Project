import { TextChecker } from "@/components/text-checker";

export const metadata = { title: "Chat with NIA · DailyMattr" };

/** The full chat with NIA, on the whole screen. */
export default function ChatPage() {
  return (
    <main className="h-dvh">
      <TextChecker />
    </main>
  );
}
