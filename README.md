# luma-intel

Vibe check a Luma event in advance and see which attendees you already know.

1. Clone the repo
2. Run `npm start`
3. Open the printed URL and paste the Luma guest list

Pasting kicks off enrichment automatically in the background — no command to
type. The page shows each person with their LinkedIn / socials, bio, and the
events they've hosted as clickable Luma links.

The same data is also written to **two files**:

- **`out/people.md`** — one block per person: name, username, profile URL,
  LinkedIn / Instagram / X / website / YouTube (whatever they listed), Luma bio,
  events-attended count, events-hosted count, and the **list of events they've
  hosted as title + link**.
- **`out/events.md`** — every hosted event's **description**, collected in one
  place (so descriptions don't clutter the people file).

---
## CLI

The same pipeline runs from the command line if you'd rather not use the page:

```bash
node enrich.mjs luma-guests.json     # a JSON list of guests
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

## Project structure

```
index.html            # capture page (browser): keeps the profile links
server.mjs            # local server: serves the page, runs enrichment in the background
enrich.mjs            # CLI entry point
src/
  net.mjs             # cached, rate-limited HTTP (one global limiter)
  input.mjs           # load /user/ URLs from json / html / txt
  luma.mjs            # profile parse, hosted-events pagination, event fetch
  prosemirror.mjs     # flatten event description_mirror -> plain text
  rolodex.mjs         # orchestration: profiles first, then descriptions
  render.mjs          # write the two output files (people + events)
```
