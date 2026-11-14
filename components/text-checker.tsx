"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ExternalLink,
  ImagePlus,
  MessageCircleQuestion,
  Sparkles,
  Square,
  SquarePen,
} from "lucide-react";
import { PixImage } from "@/components/pix-image";
import { ThemeToggle } from "@/components/theme-toggle";
import { BOT_NAME, CHECK_FAILED, type ChatMessage, type ChatQuestion, type ChatReply } from "@/lib/chat-text";
import { cn } from "@/lib/utils";

/* "Ask NIA": a chat with the fact-check assistant. Paste a message or a news
 * link, get a True / False answer with its sources, then ask follow-up
 * questions about that news. Every reply comes from /api/chat-demo, which
 * builds the same messages as the chat API (/api/v1/chat). The conversation
 * is gone on reload. */

const MIN_LENGTH = 15; // shorter messages get "send me the whole message"
const MAX_LENGTH = 5000;

/** What the assistant says it is doing while a check runs (time-based: the
 * API reports no progress). */
const TEXT_STEPS = [
  "Reading the message…",
  "Searching DailyMattr…",
  "Asking fact-checkers…",
  "Checking every claim…",
  "Searching the news…",
  "Writing the reply…",
];
const LINK_STEPS = ["Reading the article…", "Finding other outlets…", "Checking every claim…", "Searching the news…"];
const ANSWER_STEPS = ["Reading the sources…", "Writing the answer…"];

type UserItem = { kind: "user"; id: string; text: string };
type BotItem =
  | { kind: "bot"; id: string; message: ChatMessage }
  | { kind: "questions"; id: string; questions: ChatQuestion[]; news: number; about: string }; // about: the checked message or link
type Item = UserItem | BotItem;

/** The conversation as turns: the reader's message, then everything the
 * assistant said in reply. */
type Turn = { id: string; user: UserItem } | { id: string; bot: BotItem[] };

function toTurns(items: Item[]): Turn[] {
  const turns: Turn[] = [];
  for (const item of items) {
    const last = turns[turns.length - 1];
    if (item.kind === "user") turns.push({ id: item.id, user: item });
    else if (last && "bot" in last) last.bot.push(item);
    else turns.push({ id: item.id, bot: [item] });
  }
  return turns;
}

const now = () => Date.now();
const newId = () => `${now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const isLink = (text: string) => /^(https?:\/\/|www\.)\S+\.\S+$/i.test(text.trim());
/** Short messages are fine once there's news in the chat ("why?", "explain"). */
const canSend = (text: string, hasNews = false) =>
  isLink(text) || text.trim().length >= (hasNews ? 2 : MIN_LENGTH);
/** Reads like a question about the news in the chat (the API decides). */
const QUESTION_LIKE =
  /\?\s*$|^(who|whom|whose|what|what's|whats|why|how|when|where|which|explain|tell|describe|summari[sz]e|elaborate|more|details?|meaning|define|is|are|was|were|do|does|did|can|could|will|would|should|has|have)\b/i;

export function TextChecker() {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ startedAt: number; steps: string[] } | null>(null);
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set()); // question ids already asked
  // How many news items this chat has checked: typed questions are about the
  // latest one, and only its question list can still be used.
  const [news, setNews] = useState(0);
  const chatId = useRef<string | null>(null); // the API's userId for this chat
  const [focus, setFocus] = useState<{ id: string; block: ScrollLogicalPosition } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Show a new message: the reader's at the bottom, the assistant's reply from its top.
  useEffect(() => {
    if (!focus) return;
    list.current
      ?.querySelector(`[data-item="${focus.id}"]`)
      ?.scrollIntoView({ block: focus.block, behavior: "smooth" });
  }, [focus]);

  /** Show the reader's message, ask the chat API, show its replies. */
  async function talk(said: string, body: Record<string, unknown>, steps: string[]) {
    const user: Item = { kind: "user", id: newId(), text: said };
    setItems((all) => [...all, user]);
    setPending({ startedAt: now(), steps });
    setFocus({ id: user.id, block: "end" });

    const controller = new AbortController();
    abort.current = controller;
    let reply: ChatReply;
    try {
      const res = await fetch("/api/chat-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, messageId: user.id, userId: (chatId.current ??= `web-${newId()}`) }),
        signal: controller.signal,
      });
      const data = await res.json();
      reply = Array.isArray(data?.messages) ? data : { kind: "error", messages: [{ text: CHECK_FAILED, replyTo: user.id }] };
    } catch {
      const stopped = controller.signal.aborted;
      reply = { kind: "error", messages: [{ text: stopped ? "Stopped." : CHECK_FAILED, replyTo: user.id }] };
    }
    if (abort.current !== controller) return; // "New chat" cleared this conversation
    abort.current = null;

    // New news replaces the chat's earlier news (the API forgets it too).
    const seq = reply.kind === "check" ? news + 1 : news;
    if (seq !== news) setNews(seq);
    const bots: Item[] = reply.messages.map((m) => ({ kind: "bot", id: newId(), message: m }));
    if (reply.questions?.length) {
      bots.push({ kind: "questions", id: newId(), questions: reply.questions, news: seq, about: said });
    }
    setItems((all) => [...all, ...bots]);
    setPending(null);
    if (bots[0]) setFocus({ id: bots[0].id, block: "start" });
  }

  function send(message = text.trim()) {
    if (pending || !canSend(message, news > 0)) return;
    setText("");
    const followUp = news > 0 && !isLink(message) && (message.length < MIN_LENGTH || QUESTION_LIKE.test(message));
    void talk(message, { text: message }, isLink(message) ? LINK_STEPS : followUp ? ANSWER_STEPS : TEXT_STEPS);
  }

  /** A follow-up question. The list stays where it is, under its check: scroll
   * back to it to ask another. The news goes along (`about`), so the question
   * still gets its answer if the server no longer has that news. */
  function ask(question: ChatQuestion, about: string) {
    if (pending) return;
    setAsked((all) => new Set(all).add(question.id));
    void talk(question.title, { type: "question", questionId: question.id, text: about }, ANSWER_STEPS);
  }

  function newChat() {
    const running = abort.current;
    abort.current = null;
    running?.abort();
    setItems([]);
    setText("");
    setPending(null);
    setAsked(new Set());
    setNews(0);
    chatId.current = null; // a new chat starts with no news
    input.current?.focus();
  }

  const empty = items.length === 0 && !pending;

  return (
    <div className="relative flex h-full flex-col">
      {empty && <ThemeToggle className="absolute top-3 right-3 z-10 text-muted-foreground hover:text-foreground" />}
      {!empty && (
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <BotAvatar />
            <span className="font-semibold">{BOT_NAME}</span>
            <span className="truncate text-muted-foreground">Fact-check assistant</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle className="text-muted-foreground hover:text-foreground" />
            <button
              type="button"
              onClick={newChat}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-sm font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SquarePen className="size-4" aria-hidden /> New chat
            </button>
          </div>
        </div>
      )}

      {/* The welcome, until the first message; then the conversation */}
      <div
        ref={list}
        className={cn("min-h-0 overflow-y-auto", empty ? "flex flex-[1_1_0] flex-col justify-end" : "flex-1")}
      >
        {empty ? (
          <div className="mx-auto w-full max-w-2xl px-4 pt-8 pb-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Sparkles className="size-6" aria-hidden />
            </div>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">Is this news real?</h1>
            <p className="mx-auto mt-2 max-w-md text-balance text-muted-foreground">
              Paste a forwarded message or a news link. {BOT_NAME} checks the facts and tells you if it&apos;s true or
              false.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
            {toTurns(items).map((turn) => (
              <div key={turn.id} data-item={turn.id} className="scroll-mt-4 scroll-mb-4">
                {"user" in turn ? (
                  <UserMessage text={turn.user.text} />
                ) : (
                  <BotTurn>
                    {turn.bot.map((item) =>
                      item.kind === "bot" ? (
                        <BotMessage key={item.id} message={item.message} />
                      ) : (
                        <Questions
                          key={item.id}
                          questions={item.questions}
                          onAsk={(q) => ask(q, item.about)}
                          asked={asked}
                          disabled={pending !== null || item.news !== news}
                          stale={item.news !== news}
                        />
                      ),
                    )}
                  </BotTurn>
                )}
              </div>
            ))}
            {pending && (
              <BotTurn>
                <Typing startedAt={pending.startedAt} steps={pending.steps} />
              </BotTurn>
            )}
          </div>
        )}
      </div>

      <div className={cn("mx-auto w-full shrink-0 px-4", empty ? "max-w-2xl" : "max-w-3xl pb-3")}>
        <Composer
          inputRef={input}
          value={text}
          onChange={setText}
          onSubmit={() => send()}
          onStop={() => abort.current?.abort()}
          busy={pending !== null}
          hasNews={news > 0}
          roomy={empty}
        />
        {!empty && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Checks are automated. Open the sources to confirm.
          </p>
        )}
      </div>

      {/* Keeps the welcome and the message box in the middle of the screen */}
      {empty && <div className="flex-[1_1_0]" />}
    </div>
  );
}

/* ---------- message text ---------- */

const INLINE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;

/** The chat API's light markup: *bold*, _italic_ and ~strike~; blank lines
 * are paragraph breaks. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((para, p) => (
        <p key={p} className="mt-3 first:mt-0">
          {para.split("\n").map((line, l) => (
            <Fragment key={l}>
              {l > 0 && <br />}
              {line.split(INLINE).map((part, k) => {
                const inner = part.slice(1, -1);
                if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <strong key={k}>{inner}</strong>;
                if (part.length > 2 && part.startsWith("_") && part.endsWith("_")) return <em key={k}>{inner}</em>;
                if (part.length > 2 && part.startsWith("~") && part.endsWith("~")) return <s key={k}>{inner}</s>;
                return <Fragment key={k}>{part}</Fragment>;
              })}
            </Fragment>
          ))}
        </p>
      ))}
    </>
  );
}

/* ---------- messages ---------- */

function BotAvatar() {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
      aria-hidden
    >
      <Sparkles className="size-4" />
    </span>
  );
}

/** Everything the assistant says in reply to one message, under its name. */
function BotTurn({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 text-sm font-semibold">
        <BotAvatar />
        {BOT_NAME}
      </div>
      <div className="mt-2 space-y-4 sm:pl-9.5">{children}</div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 500;
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-chat-user px-4 py-2.5 text-[15px] leading-relaxed text-chat-user-foreground sm:max-w-[75%]">
        <p className={cn("break-words whitespace-pre-wrap", long && !open && "line-clamp-8")}>{text}</p>
        {long && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-1 text-sm font-medium underline underline-offset-2"
          >
            {open ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  );
}

function BotMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="space-y-3">
      {message.image && (
        <PixImage src={message.image} alt="" size={[720, 405]} className="aspect-video w-full max-w-md rounded-xl border" />
      )}
      <div className="text-[15px] leading-relaxed break-words">
        <RichText text={message.text} />
      </div>
      {message.buttons && message.buttons.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {message.buttons.map((b) => (
            <a
              key={b.url}
              href={b.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-3.5 text-sm font-medium text-primary transition-colors outline-none hover:border-primary/50 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              {b.label}
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Follow-up questions about the checked news, behind an open / close
 * button so they don't crowd the reply. Sent once per check and usable until
 * newer news is checked; questions already asked are ticked. */
function Questions({
  questions,
  onAsk,
  asked,
  disabled,
  stale,
}: {
  questions: ChatQuestion[];
  onAsk: (q: ChatQuestion) => void;
  asked: ReadonlySet<string>;
  disabled: boolean;
  /** Newer news has come since: these questions are about forgotten news. */
  stale: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  // Opened at the bottom of the chat: bring the questions into view.
  useEffect(() => {
    if (open) box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);
  if (stale) {
    return <p className="text-xs text-muted-foreground">Follow-up questions here were about earlier news.</p>;
  }
  return (
    <div ref={box} className="scroll-mb-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          "inline-flex h-9 max-w-full items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors outline-none hover:border-primary/50 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          open ? "border-primary/50 bg-accent text-accent-foreground" : "bg-card",
        )}
      >
        <MessageCircleQuestion className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="truncate">Ask a follow-up</span>
        <span className="text-xs text-muted-foreground tabular-nums">{questions.length}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul id={listId} className="mt-2 grid gap-1.5 sm:grid-cols-2 sm:gap-2">
          {questions.map((q) => (
            <li key={q.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onAsk(q)}
                disabled={disabled}
                className="flex h-full w-full items-center gap-2.5 rounded-xl border bg-card px-3.5 py-2 text-left transition-colors outline-none hover:border-primary/50 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:items-start sm:py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{q.title}</span>
                  {/* Phones: the title alone, to keep the list short. */}
                  <span className="hidden text-xs text-muted-foreground sm:block">{q.description}</span>
                </span>
                {asked.has(q.id) ? (
                  <Check className="size-4 shrink-0 text-primary sm:mt-0.5" aria-label="Asked" />
                ) : (
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground sm:mt-0.5" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** While a check runs: three dots, and what the check is doing right now. */
function Typing({ startedAt, steps }: { startedAt: number; steps: string[] }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep(Math.min(Math.floor((now() - startedAt) / 7_000), steps.length - 1)), 1_000);
    return () => clearInterval(timer);
  }, [startedAt, steps]);
  return (
    <div className="flex h-7 items-center gap-3 text-sm text-muted-foreground">
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 animate-bounce rounded-full bg-primary"
            style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }}
          />
        ))}
      </span>
      <span className="animate-pulse motion-reduce:animate-none" aria-live="polite">
        {steps[step]}
      </span>
    </div>
  );
}

/* ---------- composer ---------- */

function Composer({
  inputRef,
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  hasNews,
  roomy,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  hasNews: boolean; // there's news in the chat: short questions about it are fine
  roomy: boolean; // the welcome screen: a taller box
}) {
  const [soon, setSoon] = useState(false); // the "photos are coming soon" note
  const length = value.trim().length;
  const hint = soon
    ? "Checking photos is coming soon. Send the text or a news link."
    : isLink(value)
      ? "News link: the article is checked against other outlets."
      : !hasNews && length > 0 && length < MIN_LENGTH
        ? "Send the whole message: this is too short to check."
        : value.length > MAX_LENGTH - 500
          ? `${value.length.toLocaleString("en-IN")} / ${MAX_LENGTH.toLocaleString("en-IN")} characters`
          : null;

  // Grow with the text, up to about six lines; refit when the width changes.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      const full = el.scrollHeight;
      el.style.height = `${Math.min(full, 160)}px`;
      el.style.overflowY = full > 160 ? "auto" : "hidden";
    };
    fit();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [inputRef, value]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="rounded-2xl border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-primary/60 focus-within:ring-3 focus-within:ring-ring/15"
    >
      <label htmlFor="message" className="sr-only">
        Message
      </label>
      <textarea
        ref={inputRef}
        id="message"
        rows={1}
        maxLength={MAX_LENGTH}
        value={value}
        onChange={(e) => {
          setSoon(false);
          onChange(e.target.value);
        }}
        onPaste={(e) => {
          // A pasted picture: say photos can't be checked yet.
          if ([...e.clipboardData.files].some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            setSoon(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={hasNews ? "Ask about this news, or paste new news" : "Paste a message or a news link"}
        className={cn(
          "block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground",
          roomy && "min-h-18",
        )}
      />
      <div className="flex items-center gap-2 px-2.5 pt-1 pb-2.5">
        <button
          type="button"
          onClick={() => setSoon(true)}
          aria-label="Add a photo (coming soon)"
          title="Add a photo (coming soon)"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ImagePlus className="size-5" />
        </button>
        <p className="min-w-0 flex-1 text-xs leading-tight text-muted-foreground" aria-live="polite">
          {hint}
        </p>
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop checking"
            title="Stop checking"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity outline-none hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend(value, hasNews)}
            aria-label="Send"
            title="Send"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity outline-none hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-35"
          >
            <ArrowUp className="size-5" />
          </button>
        )}
      </div>
    </form>
  );
}
