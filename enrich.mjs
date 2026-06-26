#!/usr/bin/env node
/**
 * luma-intel · build the rolodex
 *
 * Input : luma-guests.json (from index.html), a raw guest-list .html file,
 *         or a .txt/.csv of /user/ URLs.
 *
 * For each person it captures: name, Luma username/URL, LinkedIn + socials,
 * bio, attended count, hosted count. With --events it also lists every event
 * they've hosted (name + lu.ma URL + date + city); with --descriptions it saves
 * each hosted event's description to out/events/.
 *
 * Output: out/rolodex.json, out/room.md, out/room.csv, out/events/*.md
 *
 * Usage:
 *   node enrich.mjs luma-guests.json
 *   node enrich.mjs guest-list.html --events --descriptions
 *   node enrich.mjs luma-guests.json --linkedin     # LinkedIn research packet
 *                                                    # (or Proxycurl if key set)
 * Flags:
 *   --events           list each person's hosted events
 *   --descriptions     also fetch + save each hosted event's description
 *   --linkedin         produce LinkedIn data (Proxycurl if PROXYCURL_API_KEY,
 *                      else a research packet for an AI agent)
 *   --delay <ms>       min gap between requests (default 1000)
 *   --concurrency <n>  parallel requests (default 2)
 *   --max <n>          cap people processed
 */

import { configure } from "./src/net.mjs";
import { loadProfileUrls } from "./src/input.mjs";
import { buildRolodex } from "./src/rolodex.mjs";
import { writeRolodex } from "./src/render.mjs";
import { hasProxycurl, enrichRolodexLinkedIn, writeResearchPacket } from "./src/linkedin.mjs";

const args = process.argv.slice(2);
const inputPath = args.find((a) => !a.startsWith("--"));
const has = (f) => args.includes("--" + f);
const opt = (f, def) => { const i = args.indexOf("--" + f); return i >= 0 ? args[i + 1] : def; };

async function main() {
  if (!inputPath) {
    console.error("usage: node enrich.mjs <luma-guests.json | guest-list.html | urls.txt> [--events] [--descriptions] [--linkedin] [--delay ms] [--concurrency n] [--max n]");
    process.exit(1);
  }

  configure({ delayMs: Number(opt("delay", 1000)), concurrency: Number(opt("concurrency", 2)) });

  let urls = await loadProfileUrls(inputPath);
  if (!urls.length) { console.error("No /user/ profile URLs found in input."); process.exit(1); }
  const max = Number(opt("max", 0));
  if (max > 0) urls = urls.slice(0, max);

  console.error(`Building rolodex for ${urls.length} people…`);
  const people = await buildRolodex(urls, {
    includeEvents: has("events") || has("descriptions"),
    includeDescriptions: has("descriptions"),
    onProgress: (p, i, n) => {
      const li = p.socials?.linkedin ? "li✓" : "li—";
      const ev = p.hostedEvents?.length ? ` · ${p.hostedEvents.length} hosted` : "";
      console.error(`  [${i + 1}/${n}] ${p.error ? "ERR " + p.error : `${p.name || p.profileUrl} · ${li}${ev}`}`);
    },
  });

  if (has("linkedin")) {
    if (hasProxycurl()) {
      console.error("LinkedIn: enriching via Proxycurl…");
      await enrichRolodexLinkedIn(people, { onProgress: (p) => console.error(`  li ${p.name}: ${p.linkedinProfile?.occupation || p.linkedinProfile?.error || "ok"}`) });
    } else {
      const n = await writeResearchPacket(people);
      console.error(`LinkedIn: no PROXYCURL_API_KEY set — wrote a research packet for ${n} people to out/linkedin-research.{md,jsonl} (feed to an AI agent with browsing).`);
    }
  }

  const { eventFiles } = await writeRolodex(people);
  const withLi = people.filter((p) => p.socials?.linkedin).length;
  console.error(`\nWrote out/rolodex.json, room.md, room.csv${eventFiles ? `, ${eventFiles} event files` : ""} — LinkedIn for ${withLi}/${people.length}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
