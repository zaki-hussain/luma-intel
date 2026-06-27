# luma-intel

Keep a personal log of the Luma events you've been to, then check any event
you're considering to see which guests you've already crossed paths with.

Your data lives **in your own browser** (localStorage). The only server-side
piece is a tiny stateless function that fetches Luma pages — the one thing a
browser can't do itself (CORS). So a deployed copy is zero-setup: open the URL
and use it.

## Deploy to Netlify (zero setup for anyone who opens it)

Connect the repo to Netlify and deploy. The included `netlify.toml` already sets
everything; the UI-field equivalents are:

| field | value |
| --- | --- |
| Base directory | *(blank)* |
| Package directory | *(blank)* |
| Build command | `npm run build:site` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |

Netlify publishes the page from `dist/` and deploys `netlify/functions/luma.mjs`
(reachable at `/api/luma`). Nothing to install or run — visitors just open the
domain, and each person's events/cache stay in their own browser.

## Run locally

```bash
npm start        # serves the page + /api/luma at http://localhost:5178
```

(You can also host the page anywhere and point it at a local server with
`?api=http://localhost:5178` — the server sends CORS headers and browsers allow
HTTPS pages to call `http://localhost`.)

## How it works

- **Save an event you attended.** Paste its Luma URL, paste the guest list, and
  hit *Save attended event*. The event's hosts (read from the public event page)
  are folded in as attendees too. Each guest's profile (LinkedIn / socials / bio)
  is resolved once and cached. Events are listed newest-first. For events you
  saved earlier, *Add hosts* (per event) or *Fetch hosts (all events)* backfills
  the hosts retroactively.
- **Check an event.** Paste a new event's URL + guest list (or click *Check* on a
  saved one). The people you've already been to an event with are flagged, with
  links to *which* of your events you met them at. Profiles seen before are
  reused from the cache, so only new faces are fetched.
- **Get the profiles as markdown.** The checked event's full rolodex (name,
  LinkedIn / socials, bio, attended/hosted counts, and shared-event history) is
  available to **Copy markdown** or **Download .md**.
- **People you've met.** A ranked list of everyone across your saved events,
  most-frequent first, with their socials and which events you share.
- **Export / Import.** Back up everything (events, guest lists, and cached
  profiles) to a JSON file and restore it later — or move it to another browser
  or device.

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
index.html               # the whole app: stores data in localStorage, calls /api/luma
netlify/functions/luma.mjs  # stateless Luma fetch+parse (deployed as /api/luma)
server.mjs               # local dev: serves the page + same /api/luma endpoint
enrich.mjs               # CLI entry point (profiles -> out/people.md)
src/
  net.mjs                # cached, rate-limited HTTP (used by the CLI)
  input.mjs              # load /user/ URLs from json / html / txt
  luma.mjs               # profile + event-page parsing (pure) and fetch helpers
  prosemirror.mjs        # (parked) flatten event description_mirror -> plain text
  rolodex.mjs            # CLI orchestration: resolve profiles
  render.mjs             # CLI: write out/people.md
```

The "events a person has hosted" feature (with per-event descriptions) is
parked — the working code is preserved, commented, in `src/luma.mjs`,
`src/rolodex.mjs`, and `src/render.mjs` so it can be revived later.
