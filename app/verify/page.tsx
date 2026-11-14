import { TextChecker } from "@/components/text-checker";

export const metadata = { title: "Is this news real? · Fact Check Mediator" };

export default function VerifyPage() {
  return (
    <main className="flex-1">
      <TextChecker />
    </main>
  );
}
