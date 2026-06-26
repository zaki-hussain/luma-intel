# luma-intel

Vibe check a Luma event in advance and see which attendees you already know.

1. Clone repo
2. Open index.html
3. Copy and paste Luma guest list


Produces **two files**:

- **`out/people.md`** — one block per person: name, username, profile URL,
  LinkedIn / Instagram / X / website / YouTube (whatever they listed), Luma bio,
  events-attended count, events-hosted count, and the **list of events they've
  hosted as title + link**.
- **`out/events.md`** — every hosted event's **description**, collected in one
  place (so descriptions don't clutter the people file).

---
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
