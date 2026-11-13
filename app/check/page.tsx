import { FactChecker } from "@/components/fact-checker";

export const metadata = { title: "Check a news link · Fact Check Mediator" };

export default function CheckPage() {
  return (
    <main className="flex-1">
      <FactChecker />
    </main>
  );
}
