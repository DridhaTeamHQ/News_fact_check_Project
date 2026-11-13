import { FactChecker } from "@/components/fact-checker";

export const metadata = { title: "Check any news · Fact Check Mediator" };

export default function CheckPage() {
  return (
    <main className="flex-1">
      <FactChecker />
    </main>
  );
}
