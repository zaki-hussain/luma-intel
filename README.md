# luma-intel

The ultimate Luma rolodex. Paste a Luma guest list, keep the profile links
(which normal paste targets throw away), and deterministically build a record of
everyone in the room:

- name, Luma username + profile URL
- **LinkedIn** (priority), Instagram, X/Twitter, website, YouTube — whatever they
  listed
- their Luma bio
- events attended count
- events hosted count **+ the full list of hosted events with URLs**, and
  optionally each event's saved description

Status: **working against real Luma data** (verified on a real guest list, real
profiles, and real hosted-event descriptions).

---

## Why links get stripped (and the fix)

Copying off a web page puts two things on your clipboard: `text/plain` (no links)
and `text/html` (the real markup, including `<a href="/user/…">`). Most inputs
read only `text/plain`, so the URLs die. The capture page reads `text/html`.

---

## Pipeline

```
Luma guest list ─copy─▶ index.html ─luma-guests.json─▶ enrich.mjs ─▶ out/rolodex.json
   (text/html)          (keeps links)                  (resolve everything)   room.md
                                                                              room.csv
                                                                              events/*.md
```

1. **Capture** — open `index.html`, paste the copied guest list, download
   `luma-guests.json` (name + `/user/…` link per guest, plus any inline socials).
2. **Enrich** — `enrich.mjs` fetches each profile and (optionally) their hosted
   events + descriptions, writing the rolodex.

`enrich.mjs` also accepts a raw copied guest-list `.html` file or a `.txt`/`.csv`
of `/user/` URLs, so you can skip the browser step.

---

## Usage

```bash
# capture page (or just open index.html in a browser)
npx serve .

# basic rolodex: name, socials, bio, counts
node enrich.mjs luma-guests.json

# + list every event each person has hosted (name + lu.ma URL + date + city)
node enrich.mjs luma-guests.json --events

# + also fetch & save each hosted event's description to out/events/
node enrich.mjs luma-guests.json --events --descriptions

# LinkedIn (see below)
node enrich.mjs luma-guests.json --linkedin
```

Flags: `--events`, `--descriptions`, `--linkedin`, `--delay <ms>` (default 1000),
`--concurrency <n>` (default 2), `--max <n>`. Everything is cached in `.cache/`
so re-runs are instant and don't re-hit Luma.

### Outputs (`out/`)

- `rolodex.json` — full structured data (the source of truth)
- `room.md` — readable, one block per person, LinkedIn first, with hosted events
- `room.csv` — spreadsheet-friendly
- `events/<slug>.md` — one file per hosted event with its description

---

## How the data is sourced (deterministic, no LLM)

- **Profile** (`/user/<username|usr-id>`): the page embeds a structured user
  object in `<script id="__NEXT_DATA__">` — `linkedin_handle`, `twitter_handle`,
  `instagram_handle`, `website`, `bio_short`, `timezone`, `is_verified`,
  `event_hosted_count`, `event_attended_count`.
- **Hosted events**: `GET api.lu.ma/user/profile/events-hosting?user_api_id=…&period=past`
  (paginated) → each event's name, `lu.ma` URL, date, city.
- **Event description**: `GET api.lu.ma/event/get?event_api_id=…` →
  `description_mirror` (ProseMirror) flattened to text.
- We deliberately ignore `event_together_count` ("shared events"), which needs
  you to be logged in.

---

## LinkedIn deep data (work history / education) — what's actually possible

You asked whether we can scrape everyone's LinkedIn (where they work, worked,
studied). Honest answer: **not by directly scraping LinkedIn.** LinkedIn gates
profiles behind an auth wall, aggressively blocks bots, and its ToS forbids
scraping; the official API won't return arbitrary people's history. So we don't
pretend to — we surface the LinkedIn **URL** and offer two real routes:

1. **Deterministic, paid — a third-party enrichment API.** We support
   **Proxycurl**: set `PROXYCURL_API_KEY` and run `--linkedin`. It takes the
   LinkedIn URL we already extracted and returns structured roles + education,
   attached to each person as `linkedinProfile`. (Costs credits; this is the
   clean automated route. Others like People Data Labs / Bright Data are
   equivalent swaps.)

2. **Free, manual/AI-assisted — a research packet.** With no key, `--linkedin`
   writes `out/linkedin-research.md` and `.jsonl`: one task per person (LinkedIn
   URL + bio + website + handles) designed to be pasted into a **separate AI
   agent with web browsing** that does the lookups and returns structured
   role/education JSON. This is the "paste a lot of info into another agent"
   tool you described — kept separate on purpose.

---

## Project structure

```
index.html            # Phase 1: clipboard capture (browser)
enrich.mjs            # CLI entry
src/
  net.mjs             # cached, rate-limited HTTP (global limiter)
  input.mjs           # load /user/ URLs from json / html / txt
  luma.mjs            # profile parse, hosted-events pagination, event fetch
  prosemirror.mjs     # flatten event description_mirror -> text
  rolodex.mjs         # orchestrate person records (+ events, + descriptions)
  render.mjs          # write rolodex.json, room.md, room.csv, events/*.md
  linkedin.mjs        # Proxycurl enrichment OR free research packet
```

---

## Notes / constraints

- We only surface socials a person put on their Luma profile.
- Fetching is cached + rate-limited; for a big list keep `--concurrency 2` and
  `--delay` ≥ 1000ms. `--descriptions` makes one extra request per hosted event,
  so it's the slowest mode (still cached).
- "Shared events" (people you've overlapped with) need login and are out of
  scope — a future feature could derive overlap from your own attended-events
  history.
