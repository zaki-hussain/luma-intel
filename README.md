# luma-intel

Paste a Luma guest list, keep the profile links (which normal paste targets
throw away), resolve everyone's **LinkedIn** + other socials, and produce a
deterministic outline you can read or feed into something else to vibe-check
the room.

Status: **working against real Luma data.** Verified on a real guest list and
real profiles (LinkedIn / X / Instagram / website / bio / timezone / past-event
counts all extracted).

---

## The core problem (and why it's solvable)

When you copy a guest list off a web page and paste it somewhere, the links
usually vanish and you're left with plain names. That's because your clipboard
holds **two** copies of what you copied:

- `text/plain` — just the visible text, no links
- `text/html` — the real markup, **including `<a href="/user/…">` to each profile**

Most inputs only read `text/plain`, so the URLs die. The capture page here reads
`text/html` instead, so the links survive.

---

## How it works (two phases)

```
Luma guest list ──copy──▶ index.html ──luma-guests.json──▶ enrich.mjs ──▶ out/room.md + room.csv
   (text/html)            (keeps links)                    (LinkedIn-first socials)
```

**Phase 1 — Capture (`index.html`):**
A static page with a paste box. Paste the copied guest list; it reads
`text/html`, finds every `/user/<username|usr-id>` profile link with the guest's
name, captures any socials shown inline in the list, and exports
`luma-guests.json` / CSV.

**Phase 2 — Enrich (`enrich.mjs`):**
For each profile it fetches the page once (cached + rate-limited) and reads the
structured user object Luma embeds in `<script id="__NEXT_DATA__">`:

| field | example | becomes |
| --- | --- | --- |
| `linkedin_handle` | `/in/joshuavantard` | `https://www.linkedin.com/in/joshuavantard` |
| `twitter_handle` | `joinicp` | `https://x.com/joinicp` |
| `instagram_handle` | `joshuavantard` | `https://instagram.com/joshuavantard` |
| `website` | `https://linktr.ee/joshuavantard` | (as-is) |
| `bio_short`, `timezone`, `is_verified` | | profile context |
| `event_hosted_count` / `event_attended_count` | `34` / `362` | "has hosted events" signal |

LinkedIn is surfaced as the priority field. **`event_together_count` ("shared
events") is deliberately ignored** — it requires being logged in and is always 0
otherwise. Same input → same output, no LLM in the loop.

---

## Usage

```bash
# Phase 1: open the capture page, paste the list, download luma-guests.json
npx serve .            # then open the printed localhost URL
# (or just open index.html directly in a browser)

# Phase 2: resolve socials
node enrich.mjs luma-guests.json --delay 1200 --concurrency 2
#   → out/profiles.json   (full structured data)
#   → out/room.md         (readable, one block per guest, LinkedIn first)
#   → out/room.csv        (spreadsheet-friendly)
```

`enrich.mjs` also accepts a raw copied guest-list `.html` file or a `.txt`/`.csv`
of `/user/` URLs, so you can skip the browser step if you prefer:

```bash
node enrich.mjs guest-list.html
```

---

## Example output (`out/room.md`)

```
## Joshua Vantard
- linkedin: https://www.linkedin.com/in/joshuavantard
- profile: https://luma.com/user/joshuavantard
- twitter: https://x.com/joinicp
- instagram: https://instagram.com/joshuavantard
- website: https://linktr.ee/joshuavantard
- events: hosted 34, attended 362
- timezone: Europe/London
```

---

## Notes / constraints

- We surface socials the person put on their Luma profile. Most have LinkedIn;
  some add X/Instagram/website. Profiles with nothing still return name + bio +
  past-event counts + timezone.
- LinkedIn blocks scraping, so we surface the **link**, not scraped LinkedIn
  content. Going deeper would need a separate, opt-in approach.
- Fetching is cached (`.cache/`) and rate-limited to stay polite to Luma. For a
  large list, keep `--concurrency` low (2) and `--delay` ≥ 1000ms.
- "Shared events" (people you've overlapped with) need login and are out of
  scope; a future version could derive overlap from your own attended-events
  history instead of per-profile scraping.
