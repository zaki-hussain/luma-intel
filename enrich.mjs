#!/usr/bin/env node
/**
 * luma-intel · build the people rolodex from the command line
 *
 * Input : luma-guests.json (a JSON list of guests), a raw guest-list .html
 *         file, or a .txt/.csv of /user/ URLs.
 *
 * For each person it captures: name, Luma username/URL, LinkedIn + Instagram +
 * X + website + YouTube (whatever they listed), Luma bio, and the
 * events-attended / events-hosted counts.
 *
 * Output:
 *   out/people.md   (or people.json with --json)
 *
 * Usage:
 *   node enrich.mjs luma-guests.json
 *   node enrich.mjs guest-list.html
 *   node enrich.mjs urls.txt --json
 *
 * Flags:
 *   --json              emit people.json instead of markdown
 *   --delay <ms>        min gap between requests (default 1000)
 *   --concurrency <n>   parallel requests (default 2)
 *   --max <n>           cap number of people processed
 *
 * (The "events a person has hosted" feature is currently parked — see the
 *  commented blocks in src/luma.mjs and src/rolodex.mjs.)
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { configure } from "./src/net.mjs";
import { loadProfileUrls } from "./src/input.mjs";
import { buildRolodex } from "./src/rolodex.mjs";
import { writeRolodex, peopleJson } from "./src/render.mjs";

const args = process.argv.slice(2);
const inputPath = args.find((a) => !a.startsWith("--"));
const has = (f) => args.includes("--" + f);
const opt = (f, def) => { const i = args.indexOf("--" + f); return i >= 0 ? args[i + 1] : def; };

async function main() {
  if (!inputPath) {
    console.error("usage: node enrich.mjs <luma-guests.json | guest-list.html | urls.txt> [--json] [--delay ms] [--concurrency n] [--max n]");
    process.exit(1);
  }

  configure({ delayMs: Number(opt("delay", 1000)), concurrency: Number(opt("concurrency", 2)) });

  let urls = await loadProfileUrls(inputPath);
  if (!urls.length) { console.error("No /user/ profile URLs found in input."); process.exit(1); }
  const max = Number(opt("max", 0));
  if (max > 0) urls = urls.slice(0, max);

  console.error(`Building rolodex for ${urls.length} people…`);
  const people = await buildRolodex(urls, {
    onProgress: (p, i, n) => {
      console.error(`  [${i + 1}/${n}] ${p.error ? "ERR " + p.error : (p.name || p.profileUrl)}`);
    },
  });

  const ok = people.filter((p) => !p.error).length;
  if (has("json")) {
    await mkdir("out", { recursive: true });
    await writeFile(path.join("out", "people.json"), JSON.stringify(peopleJson(people), null, 2));
    console.error(`\nWrote out/people.json — ${ok}/${people.length} people resolved.`);
  } else {
    const { peopleFile } = await writeRolodex(people);
    console.error(`\nWrote out/${peopleFile} — ${ok}/${people.length} people resolved.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
