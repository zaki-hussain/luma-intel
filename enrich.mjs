#!/usr/bin/env node
/**
 * luma-intel · profile enrichment (Phase 2)
 *
 * Input : luma-guests.json (exported from index.html) OR a .txt/.csv of URLs.
 * Output: out/profiles.json  (structured)  and  out/room.md  (readable outline).
 *
 * What it does, deterministically:
 *   1. For each Luma profile URL, fetch the page once (cached to .cache/).
 *   2. Pull the person's name/bio and every outbound social link
 *      (LinkedIn, X/Twitter, Instagram, GitHub, personal site, etc.).
 *   3. Extraction order is fixed: structured JSON embedded in the page first
 *      (Next.js data / JSON-LD), then a fallback sweep of <a href> anchors.
 *
 * NOTE: the precise JSON shape Luma embeds is verified against a real captured
 * profile before this is relied on. Until then it runs in best-effort mode and
 * reports exactly what it found vs. what it could not parse.
 *
 * Usage:
 *   node enrich.mjs luma-guests.json
 *   node enrich.mjs urls.txt --delay 1500 --concurrency 2
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const SOCIAL_HOSTS = {
  "linkedin.com": "linkedin",
  "lnkd.in": "linkedin",
  "twitter.com": "twitter",
  "x.com": "twitter",
  "instagram.com": "instagram",
  "github.com": "github",
  "t.me": "telegram",
  "youtube.com": "youtube",
  "tiktok.com": "tiktok",
  "substack.com": "substack",
  "medium.com": "medium",
  "warpcast.com": "farcaster",
};

// LinkedIn is the priority, then X and Instagram; everything else trails.
const SOCIAL_ORDER = ["linkedin", "twitter", "instagram", "github", "telegram", "youtube", "tiktok", "substack", "medium", "farcaster", "website"];
function orderSocials(socials) {
  const out = {};
  for (const k of SOCIAL_ORDER) if (socials[k]) out[k] = socials[k];
  for (const k of Object.keys(socials)) if (!(k in out)) out[k] = socials[k];
  return out;
}

const args = process.argv.slice(2);
const inputPath = args.find((a) => !a.startsWith("--"));
const opt = (name, def) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : def;
};
const DELAY_MS = Number(opt("delay", 1200));
const CONCURRENCY = Number(opt("concurrency", 2));
const CACHE_DIR = ".cache";
const OUT_DIR = "out";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadUrls(file) {
  const raw = await readFile(file, "utf8");
  if (file.endsWith(".json")) {
    const data = JSON.parse(raw);
    const list = data.guests || data.allLinks || data;
    return [...new Set(list.map((g) => (typeof g === "string" ? g : g.href || g.url)).filter(Boolean))];
  }
  // .txt / .csv: grab anything that looks like a lu.ma url
  return [...new Set((raw.match(/https?:\/\/[^\s",]+/g) || []).filter((u) => /lu\.ma/.test(u)))];
}

async function cachedFetch(url) {
  await mkdir(CACHE_DIR, { recursive: true });
  const key = createHash("sha1").update(url).digest("hex");
  const file = path.join(CACHE_DIR, key + ".html");
  try {
    await stat(file);
    return { html: await readFile(file, "utf8"), cached: true };
  } catch {}
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; luma-intel/0.1; personal research)",
      "accept": "text/html",
    },
  });
  const html = await res.text();
  if (res.ok) await writeFile(file, html);
  return { html, cached: false, status: res.status };
}

function extractEmbeddedJson(html) {
  const blobs = [];
  const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextData) { try { blobs.push(JSON.parse(nextData[1])); } catch {} }
  const ldRe = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = ldRe.exec(html))) { try { blobs.push(JSON.parse(m[1])); } catch {} }
  return blobs;
}

function* walkStrings(obj) {
  if (obj == null) return;
  if (typeof obj === "string") { yield obj; return; }
  if (typeof obj !== "object") return;
  for (const v of Object.values(obj)) yield* walkStrings(v);
}

// Ignore Luma's own assets/links and common CDNs so "website" stays meaningful.
const IGNORE_HOSTS = [/(^|\.)lu\.ma$/, /(^|\.)luma\.com$/, /\.cloudfront\.net$/, /\.amazonaws\.com$/, /(^|\.)gstatic\.com$/, /(^|\.)googleapis\.com$/];

function classifySocials(urls) {
  const found = {};
  for (const raw of urls) {
    let u;
    try { u = new URL(raw); } catch { continue; }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    const host = u.hostname.replace(/^www\./, "");
    if (IGNORE_HOSTS.some((re) => re.test(host))) continue;
    const kind = SOCIAL_HOSTS[host] || "website";
    (found[kind] ||= new Set()).add(u.href);
  }
  return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, [...v]]));
}

function extractProfile(url, html, status) {
  const blobs = extractEmbeddedJson(html);
  const allStrings = blobs.flatMap((b) => [...walkStrings(b)]);
  const jsonUrls = allStrings.filter((s) => /^https?:\/\//.test(s));

  const anchorUrls = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/);
  const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/);

  const socials = orderSocials(classifySocials([...jsonUrls, ...anchorUrls]));

  return {
    profileUrl: url,
    status: status ?? 200,
    name: (ogTitle?.[1] || titleMatch?.[1] || "").replace(/\s+/g, " ").trim() || null,
    bio: ogDesc?.[1]?.trim() || null,
    linkedin: socials.linkedin?.[0] || null, // priority field for quick scanning
    socials,
    parsed: blobs.length > 0,
    note: blobs.length ? null : "no embedded JSON found — extracted from anchors only",
  };
}

async function runPool(items, worker) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
      await sleep(DELAY_MS);
    }
  });
  await Promise.all(runners);
  return out;
}

function toMarkdown(profiles) {
  const lines = [`# Room outline`, ``, `${profiles.length} guests · generated ${new Date().toISOString()}`, ``];
  for (const p of profiles) {
    lines.push(`## ${p.name || "(unknown)"}`);
    lines.push(`- linkedin: ${p.linkedin || "— (none on profile)"}`);
    lines.push(`- profile: ${p.profileUrl}`);
    if (p.bio) lines.push(`- bio: ${p.bio}`);
    for (const [k, urls] of Object.entries(p.socials || {})) {
      if (k === "linkedin") continue; // already surfaced above
      lines.push(`- ${k}: ${urls.join(", ")}`);
    }
    if (p.note) lines.push(`- _${p.note}_`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  if (!inputPath) {
    console.error("usage: node enrich.mjs <luma-guests.json | urls.txt> [--delay ms] [--concurrency n]");
    process.exit(1);
  }
  const urls = await loadUrls(inputPath);
  if (!urls.length) {
    console.error("No URLs found in input. Export JSON from index.html first.");
    process.exit(1);
  }
  console.error(`Resolving ${urls.length} profiles (delay ${DELAY_MS}ms, concurrency ${CONCURRENCY})…`);

  const profiles = await runPool(urls, async (url, idx) => {
    try {
      const { html, cached, status } = await cachedFetch(url);
      const p = extractProfile(url, html, status);
      console.error(`  [${idx + 1}/${urls.length}] ${cached ? "cache" : "fetch"} ${url} → ${p.name || "?"}`);
      return p;
    } catch (e) {
      console.error(`  [${idx + 1}/${urls.length}] FAILED ${url}: ${e.message}`);
      return { profileUrl: url, error: e.message };
    }
  });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "profiles.json"), JSON.stringify(profiles, null, 2));
  await writeFile(path.join(OUT_DIR, "room.md"), toMarkdown(profiles));
  console.error(`\nWrote ${OUT_DIR}/profiles.json and ${OUT_DIR}/room.md`);
}

export { extractProfile, classifySocials, extractEmbeddedJson };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
