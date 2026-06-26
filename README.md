# luma-intel

Keep a personal log of the Luma events you've been to, then check any event
you're considering to see which guests you've already crossed paths with.

1. Clone the repo
2. Run `npm start`
3. Open the printed URL

## How it works

- **Save an event you attended.** Paste its Luma URL, paste the guest list, and
  hit *Save attended event*. Your events are stored in `data/events.json`.
- **Check an event.** Paste a new event's URL + guest list (or click *Check* on a
  saved one). The page resolves every guest's profile in the background and
  flags the people you've already been to an event with — and shows *which* of
  your events you met them at.
- **Get the profiles as markdown.** The checked event's full rolodex (name,
  LinkedIn / socials, bio, attended/hosted counts, and shared-event history) is
  available to **Copy markdown** or **Download .md**, and is also written to
  `out/people.md` for manual access.

Pasting reads the `text/html` on your clipboard, so the Luma profile links
survive (a normal paste throws them away).

---
## CLI

The profile enrichment also runs from the command line:

```bash
node enrich.mjs luma-guests.json     # a JSON list of guests
node enrich.mjs guest-list.html      # a raw copied guest-list HTML file
node enrich.mjs urls.txt             # a plain list of /user/ URLs
```

### Options

| flag | effect |
| --- | --- |
| `--json` | emit `out/people.json` instead of markdown |
| `--delay <ms>` | min gap between requests (default `1000`) |
| `--concurrency <n>` | parallel requests (default `2`) |
| `--max <n>` | only process the first N people |

The polite defaults (`--concurrency 2 --delay 1000`) suit a big list.

---

## Project structure

```
index.html            # the page: save events, check events, copy/download markdown
server.mjs            # local server: serves the page, stores events, runs enrichment
enrich.mjs            # CLI entry point (profiles -> out/people.md)
src/
  net.mjs             # cached, rate-limited HTTP (one global limiter)
  input.mjs           # load /user/ URLs from json / html / txt
  luma.mjs            # profile parse + event-page metadata
  prosemirror.mjs     # (parked) flatten event description_mirror -> plain text
  rolodex.mjs         # orchestration: resolve profiles
  render.mjs          # write out/people.md
```

The "events a person has hosted" feature (with per-event descriptions) is
parked — the working code is preserved, commented, in `src/luma.mjs`,
`src/rolodex.mjs`, and `src/render.mjs` so it can be revived later.
