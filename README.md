# luma-intel

Paste in a Luma guest list, keep the profile links (which normal paste targets
throw away), resolve everyone's socials, and produce a **deterministic** outline
you can read or feed into something else to vibe-check the room.

---

## The core problem (and why it's solvable)

When you copy a guest list off a web page and paste it somewhere, the links
usually vanish and you're left with plain names. That's because your clipboard
actually holds **two** copies of what you copied:

- `text/plain` — just the visible text, no links
- `text/html` — the real markup, **including `<a href="…">` to each profile**

Most inputs only read `text/plain`, so the URLs die. The fix is simply to read
the `text/html` copy instead. That's exactly what the capture page here does.

So nothing is lost when you copy — we just need to paste into something that
keeps the rich version. No screenshots, no manual link-copying.

---

## How it works (two phases)

**Phase 1 — Capture (built, in `index.html`):**
A single static page with a paste box. You copy the guest list from Luma's host
view and paste it in. It reads `text/html`, pulls out every link + the name it's
attached to, flags the ones that look like Luma **profile** links, and lets you
export JSON/CSV. It also shows the raw captured HTML so we can lock the parser
to your exact format.

**Phase 2 — Enrich (built, in `enrich.mjs`):**
A Node script that takes those profile URLs and, for each one, fetches the Luma
profile page once (cached locally, rate-limited) and extracts, in a fixed order:

1. structured data embedded in the page (Next.js `__NEXT_DATA__` / JSON-LD)
2. a fallback sweep of every `<a href>` on the page

…then classifies the outbound links into `linkedin`, `twitter/x`, `instagram`,
`github`, `website`, etc. Output is `out/profiles.json` (structured) and
`out/room.md` (a readable per-person outline). Deterministic: same input → same
output, no LLM in the loop.

```
Luma host guest list ──copy──▶ index.html ──export JSON──▶ enrich.mjs ──▶ out/room.md
        (text/html)            (keep links)               (resolve socials)
```

---

## Usage

```bash
# Phase 1: open the capture page (any static server works)
npx serve .            # then open the printed localhost URL, paste your list
# or just open index.html directly in a browser

# Phase 2: resolve socials from the exported file
node enrich.mjs luma-guests.json --delay 1200 --concurrency 2
# → writes out/profiles.json and out/room.md
```

---

## What I need from you to finish this

The capture tool grabs links generically, but to make the parsing and the
profile-scraping **reliable** I need to see your actual data. Two small things:

1. **A real captured sample (most important).**
   Open `index.html`, paste a guest list (even 3–5 people is enough), click
   **"Copy raw captured HTML"**, and paste that back to me. That shows me the
   exact link format Luma uses (e.g. `lu.ma/u/usr-…` vs something else) so I can
   make the "is this a profile?" detection exact instead of heuristic. Feel free
   to use a public event / scrub names if you're privacy-conscious — I only need
   the *structure*.

2. **One real Luma profile URL** (yours is fine) so I can confirm how socials
   are embedded on the profile page and harden the Phase-2 extractor against the
   real markup.

Also helpful, but optional:

- Are you the **host** of these events? Hosts see the full guest list with
  profile links; regular attendees may see less. This affects what's available.
- Roughly **how many guests** per list? (Drives rate-limiting / runtime.)
- Preferred **output shape** for the "vibe check" — the current `room.md` is one
  block per person (name, bio, socials). Want a one-line-per-person table, a
  ranked/grouped view, or fields tuned for feeding into another tool?

### A couple of honest constraints

- We can only extract socials a person **actually put on their Luma profile**.
  We can't invent a LinkedIn that isn't linked anywhere. (If a profile has no
  links, we still capture name/bio and flag it.)
- LinkedIn itself blocks scraping/bots, so we surface the **link** to their
  LinkedIn rather than logging in to scrape it. Pulling richer LinkedIn detail
  would need a separate, opt-in approach — tell me if you want that.
- Fetching is rate-limited and cached to stay polite to Luma. This is meant for
  guest lists you legitimately have access to as a host.

Once you drop in the captured HTML sample + one profile URL, I'll tighten both
parsers to your exact format and we're done.
