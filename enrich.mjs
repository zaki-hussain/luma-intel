#!/usr/bin/env node
/**
 * luma-intel · build the rolodex
 *
 * Input : luma-guests.json (from index.html), a raw guest-list .html file,
 *         or a .txt/.csv of /user/ URLs.
 *
 * For each person it captures: name, Luma username/URL, LinkedIn + Instagram +
 * X + website + YouTube (whatever they listed), Luma bio, events-attended count,
 * events-hosted count, and the list of events they've hosted (title + lu.ma URL).
 * It also fetches each hosted event's description.
 *
 * Output (exactly two files):
 *   out/people.md  — the people, with their hosted events as title + link
 *   out/events.md  — every hosted event's description, in one place
 * (use --json for people.json / events.json instead)
 *
 * Usage:
 *   node enrich.mjs luma-guests.json
 *   node enrich.mjs guest-list.html
 *   node enrich.mjs luma-guests.json --json
 *
 * Flags:
 *   --json              emit people.json / events.json instead of markdown
 *   --no-descriptions   list hosted events but skip fetching their descriptions
 *   --no-events         skip hosted events entirely (profiles only)
 *   --delay <ms>        min gap between requests (default 1000)
 *   --concurrency <n>   parallel requests (default 2)
 *   --max <n>           cap number of people processed
 */

import { configure } from "./src/net.mjs";
import { loadProfileUrls } from "./src/input.mjs";
import { buildRolodex } from "./src/rolodex.mjs";
import { writeRolodex } from "./src/render.mjs";

const args = process.argv.slice(2);
const inputPath = args.find((a) => !a.startsWith("--"));
const has = (f) => args.includes("--" + f);
const opt = (f, def) => { const i = args.indexOf("--" + f); return i >= 0 ? args[i + 1] : def; };

async function main() {
  if (!inputPath) {
    console.error("usage: node enrich.mjs <luma-guests.json | guest-list.html | urls.txt> [--json] [--no-events] [--no-descriptions] [--delay ms] [--concurrency n] [--max n]");
    process.exit(1);
  }

  configure({ delayMs: Number(opt("delay", 1000)), concurrency: Number(opt("concurrency", 2)) });

  let urls = await loadProfileUrls(inputPath);
  if (!urls.length) { console.error("No /user/ profile URLs found in input."); process.exit(1); }
  const max = Number(opt("max", 0));
  if (max > 0) urls = urls.slice(0, max);

  const includeEvents = !has("no-events");
  const includeDescriptions = includeEvents && !has("no-descriptions");

  console.error(`Building rolodex for ${urls.length} people${includeEvents ? " (+ hosted events" + (includeDescriptions ? " + descriptions" : "") + ")" : ""}…`);
  const people = await buildRolodex(urls, {
    includeEvents,
    includeDescriptions,
    onProgress: (p, i, n) => {
      const ev = p.hostedEvents?.length ? ` · ${p.hostedEvents.length} hosted` : "";
      console.error(`  [${i + 1}/${n}] ${p.error ? "ERR " + p.error : `${p.name || p.profileUrl}${ev}`}`);
    },
  });

  const { peopleFile, eventsFile } = await writeRolodex(people, { json: has("json") });
  const ok = people.filter((p) => !p.error).length;
  console.error(`\nWrote out/${peopleFile} and out/${eventsFile} — ${ok}/${people.length} people resolved.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
