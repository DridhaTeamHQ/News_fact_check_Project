# NIA chat API (WhatsApp bot backend)

One endpoint. Your WhatsApp bot posts the message a person sent; the API answers with the bot's replies, ready to send, plus the check result as data. The web demo at `/verify` shows exactly these replies.

```
POST /api/v1/chat
Authorization: Bearer <CHAT_API_KEY>      (or  X-API-Key: <CHAT_API_KEY>)
Content-Type: application/json
```

`CHAT_API_KEY` is set in `.env` (see `.env.example`). Without the right key the API answers `401`.

## Request

| Field       | Type    | Notes |
|-------------|---------|-------|
| `text`      | string  | The message text. Up to 5,000 characters. |
| `type`      | string  | `"text"` (default), `"welcome"`, `"question"` (a follow-up question, see below), or the WhatsApp message type for media: `"image"`, `"video"`, `"audio"`, `"document"`, `"sticker"`, … |
| `questionId`| string  | With `type: "question"`: the `id` of the question the person picked. |
| `userId`    | string  | Recommended. Who is chatting: the sender's WhatsApp number (`wa_id`). With it, NIA remembers the person's latest news and answers their typed questions about it (see "Conversation memory"). Without it, every message stands alone. |
| `messageId` | string  | Optional. The WhatsApp message id (`wamid…`). The first reply comes back with `replyTo` set to it, so you can send it as a reply to the person's message. |
| `force`     | boolean | Optional. `true` checks again instead of using a result saved in the last 6 hours. |

What the API does with it:

| The person sent                                  | Reply `kind`  |
|--------------------------------------------------|---------------|
| A greeting (`hi`, `hello`, `start`, `help`, …), an empty message, or `type: "welcome"` | `welcome`: the NIA intro |
| A forward or any news text (15+ characters)      | `check`: the verdict with its percentage, then real news |
| Only a news link (`https://…` or `www.…`)        | `check`: the article checked against other outlets |
| An image                                         | `unsupported`: "Checking photos is coming soon" |
| Other media                                      | `unsupported`: "I can check text messages and news links" |
| Something with no news in it                     | `not-news`: asks for a forward or a link |
| A link with no readable article                  | `error`: asks for the article's own page |
| `type: "question"` with a `questionId`           | `answer`: the answer |
| A question about news the server no longer has   | `error`: asks to send the news again |

## The replies

A checked message gets two or three messages:

**1. The verdict**, as a reply to the person's message. It opens with the verdict and a percentage, then one short paragraph and one tip:

```
❌ *FALSE* · *100% fake*

🎯 *Hey, you've spotted fake news!*

This forward is *not real*. No demonetisation of ₹500 notes has been announced. *News24Online* has fact-checked this.

✅ Don't forward this message.
```

The first line is one of:

| Verdict      | First line                    | N is the share of the message's claims that are… |
|--------------|-------------------------------|---------------------------------------------------|
| False        | `❌ *FALSE* · *N% fake*`       | false or reported nowhere |
| Partly false | `⚠️ *PARTLY FALSE* · *N% fake*` | false or reported nowhere |
| Unverified   | `❓ *UNVERIFIED* · *N% confirmed*` | confirmed by trusted sources |
| Mostly true  | `✅ *MOSTLY TRUE* · *N% true*` | confirmed by trusted sources |
| True         | `✅ *TRUE* · *N% true*`        | confirmed by trusted sources |

When nothing in the message could be checked, the line has no percentage. When a fact-checker settled it but few claims were found false, the line says who instead, e.g. `❌ *FALSE* · debunked by PIB Fact Check`.

**2. DailyMattr first**: when a DailyMattr post covers this same news, it gets a message of its own, before anything else. The message has the post's photo in `image` (send it as the image header), its headline, the start of the story, and a "Read on DailyMattr" button:

```
📲 *Read the full story on DailyMattr* 👇

*Piyush Goyal to visit Egypt on November 15–16 to strengthen trade, investment ties*

• Union Commerce Minister Piyush Goyal will visit Egypt on November 15–16 to strengthen trade and investment ties.
```

The intro depends on the verdict: "Read the full story on DailyMattr" (true), "Here's the real story on DailyMattr" (false), or "DailyMattr on this news" (unverified). This works for links too: a checked article is matched to DailyMattr's post on the same news, and a DailyMattr link leads with its own post. `check.dailyMattr` gives the post's `title`, `url` and `image`, or `null` when DailyMattr hasn't covered it.

**3. Then the rest**: up to 3 more headlines, each with a "Read" button. What counts depends on the verdict:

- **True / mostly true**: only this story's own coverage. That's other DailyMattr posts on it, then other outlets ("Also reported by 👇", or "Here's the full story 👇" when DailyMattr hasn't covered it).
- **False, partly false, unverified**: only DailyMattr stories about the **exact thing the claim is about**: the same event, scheme, ban or decision, or an official denial or fact-check of it. One quick model call checks each candidate. A similar but different scheme, another state or the same general topic doesn't count. For example, "Tamil Nadu approves a state laptop scheme" is not shown for a fake "PM Free Laptop Yojana" forward.
- **Nothing related**: when no story qualifies, no news message is sent. The reply is just the verdict.

A checked **link** gets the same verdict line, the article's headline and a one-sentence reason, then up to 3 other outlets' reports with Read buttons.

## Conversation memory

With a `userId`, the last news a person had checked is their **current news**, and messages they type about it are answered from it:

| The person sends (after a check)              | NIA                                               |
|-----------------------------------------------|---------------------------------------------------|
| "who is Piyush Goyal", "why is he going there?", "explain more", "is this real?" | `answer`: answered from the current news only |
| A short message ("why?", "and then?")         | `answer`: about the current news                  |
| A forward, a news link, or "Is it true that RBI banned ₹2000 notes?" | `check`: a new check, which becomes the current news |

- **Telling them apart:** a question-like message gets one quick model call to decide whether it's about the current news or a new claim. Anything with no news in it also goes to the current news.
- **New news replaces the old:** the earlier news is forgotten completely. Its question list then answers "send the news again".
- **Answers stay grounded:** they come only from that news's own evidence. If the news doesn't cover the question, NIA says so and suggests sending a forward or link to check.
- **Privacy and lifetime:** the person's number is never stored as is, only a keyed hash, in the server's memory, for 24 hours.

## Follow-up questions

A `check` reply for **real news** (verdict `true` or `mostly-true`) has 4 `questions` about that news: Explain this news · Explain like I'm 5 · Why does it matter? · What happens next? Fake, partly false and unverified results get no questions (no `questions` field). Send them after the messages as a WhatsApp **list message**: body `"Want to know more? Pick a question 👇"`, button `"Ask about this news"`, one row per question (row `id` = question `id`, `title`, `description`).

When the person picks a row, WhatsApp sends your webhook `interactive.list_reply.id`. Post it back:

```json
{ "type": "question", "questionId": "q:eli5:WQSQjjkg34DQ", "messageId": "wamid…" }
```

The reply has `kind: "answer"` and one message with the answer. The questions are **not** sent again: the list message stays in the chat, and the person scrolls back up and taps it for another question (a WhatsApp list can be tapped any number of times).

```
🧒 *Explain like I'm 5*

*No*, the big boss in India is *not* giving free laptops to all students. But in one place called Tamil Nadu, the boss there is giving free laptops to some college kids. …
```

Answers are written by GPT (`OPENAI_API_KEY`, the same model as the fact check) from **that one news item only**: the checked message, the verdict and the sources' own words. They never bring in other news or facts from memory, and never contradict the verdict. An answer takes 2 to 6 seconds.

Each check's evidence is kept in the server's memory for 24 hours. After that, or after a restart, a question gets `kind: "error"` asking the person to send the news again.

## Response

Always JSON with `kind` and `messages`. Send the messages in order.

```json
{
  "kind": "check",
  "messages": [
    {
      "text": "❌ *FALSE* · *100% fake*\n\n🎯 *Hey, you've spotted fake news!*\n\nThis forward is *not real*. …\n\n✅ Don't forward this message.",
      "replyTo": "wamid.HBgM…"
    },
    {
      "text": "📲 *Here's the real story on DailyMattr* 👇\n\n*<the DailyMattr headline on this exact news>*\n\n• <the start of the story>",
      "image": "https://…/pix-media/….png",
      "buttons": [
        { "label": "Read on DailyMattr", "url": "https://www.dailymattr.com/news/…-19316" }
      ],
      "plainText": "📲 *Here's the real story on DailyMattr* 👇\n\n…\n\n🔗 Read on DailyMattr\nhttps://www.dailymattr.com/news/…-19316"
    }
  ],
  "check": {
    "input": "message",
    "verdict": "false",
    "verdictWord": "False",
    "percent": 100,
    "percentOf": "fake",
    "reason": "…one plain sentence…",
    "claim": "PM Modi to announce demonetisation of ₹500 notes from midnight tomorrow",
    "topic": "finance",
    "fakeCaught": true,
    "factScore": 0,
    "fakePercent": 100,
    "sources": [{ "title": "…", "source": "News24Online", "url": "https://…", "kind": "fact-check" }],
    "checkedAt": "2026-11-14T07:42:14.037Z",
    "cached": false
  }
}
```

- `text` uses WhatsApp formatting (`*bold*`, `_italic_`), so it can be sent as is.
- `buttons`: up to 3 link buttons, each label 20 characters or fewer (WhatsApp's limit). `plainText` is the same message with the links written out, for when you send plain text.
- `check` is present only when `kind` is `"check"`.
  - `verdict`: `false`, `partly-false`, `unverified`, `mostly-true` or `true`.
  - `percent` and `percentOf` (`"fake"`, `"true"` or `"confirmed"`) are the numbers in the verdict line. Both are `null` when nothing was checkable.
  - `fakeCaught` is `true` when the verdict is `false` or `partly-false`.
  - `input` is `"message"` or `"link"`; `topic` is `null` for links.
- `questions` (on `check` replies only): `[{ "id", "title", "description" }]`, sized for a WhatsApp list (title ≤ 24 characters, description ≤ 72).

Status codes:

| Status | Meaning |
|--------|---------|
| `200`  | Messages to send (also for `not-news`, `unsupported` and `error` replies). |
| `502`  | The check itself failed. The body still has an apology in `messages` you can send, and you can retry. |
| `400`  | Bad body. |
| `401`  | Wrong or missing key. |
| `503`  | A key is missing from `.env`. |

## Timing

A new check takes **30–70 seconds**. The same forward again within 6 hours takes about a second. WhatsApp's webhook wants a quick `200`, so:

1. When the webhook receives the message, answer WhatsApp `200` at once and queue the work.
2. Mark the message read and show the typing indicator.
3. Call `POST /api/v1/chat` (allow a 120-second timeout).
4. Send each item in `messages`, in order.

## Sending with the WhatsApp Cloud API

- **Reply to the person's message**: for a message with `replyTo`, add `"context": { "message_id": "<replyTo>" }`.
- **No buttons**: send a `text` message with `text.body` = `text`.
- **With an `image`** (the DailyMattr post): send it as an `interactive` `cta_url` message with `header: { "type": "image", "image": { "link": "<image>" } }`, the text as the body, and the "Read on DailyMattr" button.
- **With buttons**: the Cloud API allows **one** link button per message (`interactive` type `cta_url`; body up to 1,024 characters). You can either:
  - send `text` with the first button as a `cta_url`, or
  - send `plainText` as a normal text message, which shows all links.

  Three link buttons on one message, as in the demo, need an approved message template.

## Good to know

- Each new news item is checked on its own. The only conversation kept is each person's current news (with `userId`), in memory for 24 hours, keyed by a hash of their number.
- Saved results live in the server's memory and are lost when it restarts.
- There's no rate limit per user yet. Each new check spends OpenAI credits, so add one in your bot if needed.
- Example:

  ```bash
  curl -X POST http://localhost:3000/api/v1/chat -H "X-API-Key: $CHAT_API_KEY" -H "Content-Type: application/json" -d '{"text":"hi"}'
  ```
