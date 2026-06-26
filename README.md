# luma-intel

The ultimate Luma rolodex. Paste a Luma guest list, keep the profile links
(which normal paste targets throw away), and deterministically fetch everyone's
profile and the events they've hosted.

It produces **two files**:

- **`out/people.md`** — one block per person: name, username, profile URL,
  LinkedIn / Instagram / X / website / YouTube (whatever they listed), Luma bio,
  events-attended count, events-hosted count, and the **list of events they've
  hosted as title + link**.
- **`out/events.md`** — every hosted event's **description**, collected in one
  place (so descriptions don't clutter the people file).

Status: working against real Luma data (verified on a real guest list, real
profiles, and real hosted-event descriptions).

---

## Why copy/paste loses the links (and how this fixes it)

When you copy off a web page, your clipboard holds two versions: `text/plain`
(just the visible text — no links) and `text/html` (the real markup, including
`<a href="/user/…">` for each guest). Most apps read only `text/plain`, so the
profile links vanish. The capture page here reads `text/html`, so they survive.

---

## How to use it

### Step 1 — capture the guest list (keeps the links)

Open `index.html` in a browser (double-click it, or run `npx serve .` and open
the printed URL). On the Luma event, select and copy the guest list, then paste
into the box on the page. Click **“Download JSON (for enrich.mjs)”** — that saves
`luma-guests.json` (each guest's name + `/user/…` profile link).

> No browser? You can also right-click the guest list → Inspect → copy the
> element's outerHTML into a `.html` file and feed that to step 2 directly.

### Step 2 — build the rolodex

```bash
node enrich.mjs luma-guests.json
```

That fetches every profile and their hosted events + descriptions, and writes
`out/people.md` and `out/events.md`. Re-runs are instant because every request
is cached in `.cache/`.

Other inputs work too:

```bash
node enrich.mjs guest-list.html      # a raw copied guest-list HTML file
node enrich.mjs urls.txt             # a plain list of /user/ URLs
```

### Options

| flag | effect |
| --- | --- |
| `--json` | emit `people.json` / `events.json` instead of markdown |
| `--no-descriptions` | list hosted events (title+link) but don't fetch descriptions |
| `--no-events` | profiles only — skip hosted events entirely |
| `--delay <ms>` | min gap between requests (default `1000`) |
| `--concurrency <n>` | parallel requests (default `2`) |
| `--max <n>` | only process the first N people |

For a big list, the defaults (`--concurrency 2 --delay 1000`) keep it polite.
`--no-descriptions` is much faster if you only need the event titles + links.

---

## What it fetches, and from where (deterministic — no AI/LLM)

Same input always produces the same output.

- **Profile** `https://luma.com/user/<username|usr-id>` — the page embeds a
  structured user object in `<script id="__NEXT_DATA__">`, giving
  `linkedin_handle`, `instagram_handle`, `twitter_handle`, `website`,
  `youtube_handle`, `bio_short`, `event_attended_count`, `event_hosted_count`.
  Handles are expanded to full URLs (e.g. `/in/x` →
  `https://www.linkedin.com/in/x`).
- **Hosted events** — `GET api.lu.ma/user/profile/events-hosting?user_api_id=…&period=past`
  (paginated) → each event's name, `lu.ma` URL, date, city.
- **Event description** — `GET api.lu.ma/event/get?event_api_id=…` →
  `description_mirror`, flattened from Luma's rich-text format to plain text.

(`event_together_count` — "shared events" — is ignored on purpose: it requires
being logged in and is otherwise always 0.)

---

## Project structure

```
index.html            # capture page (browser): keeps the profile links
enrich.mjs            # CLI entry point
src/
  net.mjs             # cached, rate-limited HTTP (one global limiter)
  input.mjs           # load /user/ URLs from json / html / txt
  luma.mjs            # profile parse, hosted-events pagination, event fetch
  prosemirror.mjs     # flatten event description_mirror -> plain text
  rolodex.mjs         # orchestration: profiles (+ events, + descriptions)
  render.mjs          # write the two output files (people + events)
```

---

## Notes / constraints

- We only surface socials a person actually put on their Luma profile.
- Fetching is cached + rate-limited. `--no-descriptions` skips the per-event
  requests if you just want titles + links.
- "Shared events" (people you've overlapped with) need login and are out of
  scope; a future feature could derive overlap from your own attended-events
  history.
