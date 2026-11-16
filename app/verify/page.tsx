import { redirect } from "next/navigation";

/** The chat used to live here; it is at /chat now. */
export default function VerifyPage() {
  redirect("/chat");
}
