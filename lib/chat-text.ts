/* The chat bot's types and fixed wording, shared by the API (lib/chat-reply.ts)
 * and the web demo (components/text-checker.tsx). No server-only imports. */

import type { VerdictLabel } from "./verdict";

export const BOT_NAME = "NIA";

export const WELCOME_TEXT = `Hi 👋 I'm *${BOT_NAME}*, your news buddy.\n\nGot a forward that looks fishy? Send it my way, or paste a news link. I'll check the facts and tell you if it's *true or false* ✅❌`;

export const CHECK_FAILED = "😓 Sorry, I couldn't check that right now. Please try again in a minute.";

export type ChatButton = {
  label: string; // at most 20 characters (WhatsApp's limit for a link button)
  url: string;
};

export type ChatMessage = {
  text: string;
  /** Send as a reply to this message (the reader's WhatsApp message id). */
  replyTo?: string;
  /** Link buttons. WhatsApp's Cloud API allows one link button per message:
   * send the first as a button and the rest as text, or use `plainText`. */
  buttons?: ChatButton[];
  /** `text` with the buttons written out as links, for senders that can't
   * show buttons. Present only when there are buttons. */
  plainText?: string;
  /** A picture to show with the message (the DailyMattr post's photo): send
   * it as the message's image header. */
  image?: string;
};

export type ChatCheck = {
  input: "message" | "link";
  verdict: VerdictLabel;
  verdictWord: string; // "False", "Partly false", "Unverified", "Mostly true", "True"
  /** The percentage shown with the verdict, e.g. 100 with percentOf "fake":
   * "100% fake". Share of the checked claims; null when nothing was checkable. */
  percent: number | null;
  percentOf: "fake" | "true" | "confirmed" | null;
  reason: string; // one plain sentence
  claim: string; // the message's main claim, or the article's headline
  topic: string | null;
  /** The reader caught fake news (verdict false or partly false). */
  fakeCaught: boolean;
  factScore: number | null; // 0–100
  fakePercent: number | null; // share of claims false or reported nowhere
  sources: { title: string; source: string; url: string; kind: "dailymattr" | "fact-check" | "outlet" }[];
  /** The DailyMattr post on this same news, when there is one: the reply
   * leads with it. */
  dailyMattr: { title: string; url: string; image: string | null } | null;
  checkedAt: string;
  cached: boolean;
};

/** A follow-up question about the checked news, e.g. "Explain like I'm 5".
 * Send it back as `{ "type": "question", "questionId": id }`. Sized for a
 * WhatsApp list message: title up to 24 characters, description up to 72,
 * id up to 200. */
export type ChatQuestion = { id: string; title: string; description: string };

/** The WhatsApp list message's button text (up to 20 characters). */
export const QUESTIONS_BUTTON = "Ask about this news";
export const QUESTIONS_PROMPT = "Want to know more? Pick a question 👇";

export type ChatReply = {
  kind: "welcome" | "check" | "answer" | "not-news" | "unsupported" | "error";
  messages: ChatMessage[];
  check?: ChatCheck;
  /** Follow-up questions about this news, answered from its own sources only.
   * Sent once, on `check` replies; answers don't repeat them. */
  questions?: ChatQuestion[];
};

/** The request body of the chat API (and the web demo's route). */
export type ChatRequest = {
  type?: string; // "text" (default), "welcome", "question", or a WhatsApp media type: "image", "video", …
  /** The message. With type "question" (optional): the forward or link the
   * question is about, checked again if the server no longer has that news. */
  text?: string;
  messageId?: string;
  /** Who is chatting (their WhatsApp number): typed questions are answered
   * about their last checked news, until they send new news. */
  userId?: string;
  questionId?: string; // with type "question": a ChatQuestion id
  force?: boolean;
};
