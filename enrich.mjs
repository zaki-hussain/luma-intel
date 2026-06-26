#!/usr/bin/env node
/**
 * luma-intel · profile enrichment (Phase 2)
 *
 * Input : luma-guests.json (from index.html), a raw guest-list .html file,
 *         or a .txt/.csv of /user/ URLs.
 * Output: out/profiles.json (structured), out/room.md and out/room.csv (readable).
 *
 * For each Luma profile it fetches the page once (cached, rate-limited) and reads
 * the structured user object Luma embeds in <script id="__NEXT_DATA__">:
 *
 *   user.linkedin_handle  "/in/joshuavantard"  -> https://www.linkedin.com/in/joshuavantard
 *   user.twitter_handle   "joinicp"            -> https://x.com/joinicp
 *   user.instagram_handle "joshuavantard"      -> https://instagram.com/joshuavantard
 *   user.website          "https://linktr.ee/joshuavantard"
 *   user.bio_short, user.timezone, user.is_verified
 *   event_hosted_count / event_attended_count  (past-events signal)
 *
 * LinkedIn is treated as the priority field. We deliberately ignore
 * event_together_count ("shared events"), which requires being logged in.
 *
 * Usage:
 *   node enrich.mjs luma-guests.json
 *   node enrich.mjs guest-list.html --delay 1200 --concurrency 2
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const LUMA_BASE = "https://luma.com";

// LinkedIn first, then the rest in a stable order.
const SOCIAL_ORDER = ["linkedin", "twitter", "instagram", "website", "github", "telegram", "tiktok", "youtube"];

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

function resolveUserUrl(s) {
  if (!s) return null;
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      if (/^\/user\//.test(u.pathname)) return LUMA_BASE + u.pathname.replace(/\/$/, "");
      return s;
    }
  } catch { return null; }
  if (s.startsWith("/user/")) return LUMA_BASE + s.replace(/\/$/, "");
  return null;
}

async function loadUrls(file) {
  const raw = await readFile(file, "utf8");
  let urls = [];
  if (file.endsWith(".json")) {
    const data = JSON.parse(raw);
    const list = data.guests || data.allLinks || data;
    urls = list.map((g) => (typeof g === "string" ? g : g.profileUrl || g.href || g.url));
  } else if (file.endsWith(".html") || file.endsWith(".htm")) {
    urls = [...raw.matchAll(/href="(\/user\/[^"#?]+)"/g)].map((m) => m[1]);
  } else {
    const abs = (raw.match(/https?:\/\/[^\s",]+/g) || []).filter((u) => /lu\.ma|luma\.com/.test(u));
    const rel = (raw.match(/\/user\/[^\s",]+/g) || []);
    urls = [...abs, ...rel];
  }
  return [...new Set(urls.map(resolveUserUrl).filter(Boolean))];
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
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
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
  return blobs;
}

// Walk the embedded JSON for the object that carries the profile user + counts.
function findInitialData(blobs) {
  const seen = new Set();
  const stack = [...blobs];
  while (stack.length) {
    const o = stack.pop();
    if (!o || typeof o !== "object" || seen.has(o)) continue;
    seen.add(o);
    if (o.user && typeof o.user === "object" && ("event_hosted_count" in o || "event_attended_count" in o)) return o;
    for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
  }
  return null;
}

function findUserObject(blobs) {
  const seen = new Set();
  const stack = [...blobs];
  while (stack.length) {
    const o = stack.pop();
    if (!o || typeof o !== "object" || seen.has(o)) continue;
    seen.add(o);
    if ("linkedin_handle" in o || "twitter_handle" in o || ("username" in o && "name" in o && "avatar_url" in o)) return o;
    for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
  }
  return null;
}

function handleUrl(kind, h) {
  if (h == null || h === "") return null;
  if (/^https?:\/\//i.test(h)) return h;
  const v = String(h).trim().replace(/^@/, "");
  switch (kind) {
    case "linkedin": return "https://www.linkedin.com" + (v.startsWith("/") ? v : "/in/" + v);
    case "twitter": return "https://x.com/" + v.replace(/^\//, "");
    case "instagram": return "https://instagram.com/" + v.replace(/^\//, "");
    case "tiktok": return "https://www.tiktok.com/@" + v.replace(/^@?\/?/, "");
    case "youtube": return "https://www.youtube.com/" + v.replace(/^\//, "");
    case "github": return "https://github.com/" + v.replace(/^\//, "");
    default: return v;
  }
}

function orderSocials(socials) {
  const out = {};
  for (const k of SOCIAL_ORDER) if (socials[k]?.length) out[k] = socials[k];
  for (const k of Object.keys(socials)) if (!(k in out) && socials[k]?.length) out[k] = socials[k];
  return out;
}

function extractProfile(url, html, status) {
  const blobs = extractEmbeddedJson(html);
  const init = findInitialData(blobs);
  const user = init?.user || findUserObject(blobs);

  if (user) {
    const socials = {};
    const push = (k, v) => { const u = handleUrl(k, v); if (u) (socials[k] ||= []).push(u); };
    push("linkedin", user.linkedin_handle);
    push("twitter", user.twitter_handle);
    push("instagram", user.instagram_handle);
    push("tiktok", user.tiktok_handle);
    push("youtube", user.youtube_handle);
    push("github", user.github_handle);
    if (user.website) (socials.website ||= []).push(user.website);

    return {
      profileUrl: url,
      status: status ?? 200,
      name: (user.name || [user.first_name, user.last_name].filter(Boolean).join(" ") || "").replace(/\s+/g, " ").trim() || null,
      username: user.username || null,
      bio: (user.bio_short || "").trim() || null,
      timezone: user.timezone || null,
      verified: !!user.is_verified,
      hostedCount: init?.event_hosted_count ?? null,
      attendedCount: init?.event_attended_count ?? null,
      linkedin: (socials.linkedin || [])[0] || null,
      socials: orderSocials(socials),
      parsed: true,
      note: null,
    };
  }

  // Fallback: structured data not found — sweep anchors so we still return something.
  const anchorUrls = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const socials = {};
  const HOSTS = { "linkedin.com": "linkedin", "x.com": "twitter", "twitter.com": "twitter", "instagram.com": "instagram", "github.com": "github" };
  for (const raw of anchorUrls) {
    try { const u = new URL(raw); const k = HOSTS[u.hostname.replace(/^www\./, "")]; if (k) (socials[k] ||= []).push(u.href); } catch {}
  }
  const og = html.match(/<meta property="og:title" content="([^"]+)"/);
  return {
    profileUrl: url,
    status: status ?? 200,
    name: og ? og[1].replace(/\s*·\s*Luma$/, "").trim() : null,
    linkedin: (socials.linkedin || [])[0] || null,
    socials: orderSocials(socials),
    parsed: false,
    note: "structured profile data not found — extracted from anchors only",
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
  const ok = profiles.filter((p) => !p.error);
  const lines = [
    `# Room outline`,
    ``,
    `${ok.length} guests · generated ${new Date().toISOString()}`,
    `LinkedIn found for ${ok.filter((p) => p.linkedin).length}/${ok.length}.`,
    ``,
  ];
  for (const p of ok) {
    lines.push(`## ${p.name || p.username || "(unknown)"}${p.verified ? " ✓" : ""}`);
    lines.push(`- linkedin: ${p.linkedin || "— (none on profile)"}`);
    lines.push(`- profile: ${p.profileUrl}`);
    for (const [k, urls] of Object.entries(p.socials || {})) {
      if (k === "linkedin") continue;
      lines.push(`- ${k}: ${urls.join(", ")}`);
    }
    if (p.bio) lines.push(`- bio: ${p.bio}`);
    if (p.hostedCount != null) lines.push(`- events: hosted ${p.hostedCount}, attended ${p.attendedCount ?? "?"}`);
    if (p.timezone) lines.push(`- timezone: ${p.timezone}`);
    if (p.note) lines.push(`- _${p.note}_`);
    lines.push("");
  }
  return lines.join("\n");
}

function toCsv(profiles) {
  const cell = (v = "") => { v = String(v ?? ""); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const header = "name,linkedin,twitter,instagram,website,profileUrl,bio,hostedCount,attendedCount,timezone";
  const rows = profiles.filter((p) => !p.error).map((p) => [
    p.name, p.linkedin, (p.socials?.twitter || [])[0], (p.socials?.instagram || [])[0], (p.socials?.website || [])[0],
    p.profileUrl, p.bio, p.hostedCount, p.attendedCount, p.timezone,
  ].map(cell).join(","));
  return [header, ...rows].join("\n");
}

async function main() {
  if (!inputPath) {
    console.error("usage: node enrich.mjs <luma-guests.json | guest-list.html | urls.txt> [--delay ms] [--concurrency n]");
    process.exit(1);
  }
  const urls = await loadUrls(inputPath);
  if (!urls.length) {
    console.error("No /user/ profile URLs found in input.");
    process.exit(1);
  }
  console.error(`Resolving ${urls.length} profiles (delay ${DELAY_MS}ms, concurrency ${CONCURRENCY})…`);

  const profiles = await runPool(urls, async (url, idx) => {
    try {
      const { html, cached, status } = await cachedFetch(url);
      const p = extractProfile(url, html, status);
      console.error(`  [${idx + 1}/${urls.length}] ${cached ? "cache" : "fetch"} ${p.name || url}${p.linkedin ? " · li✓" : ""}`);
      return p;
    } catch (e) {
      console.error(`  [${idx + 1}/${urls.length}] FAILED ${url}: ${e.message}`);
      return { profileUrl: url, error: e.message };
    }
  });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "profiles.json"), JSON.stringify(profiles, null, 2));
  await writeFile(path.join(OUT_DIR, "room.md"), toMarkdown(profiles));
  await writeFile(path.join(OUT_DIR, "room.csv"), toCsv(profiles));
  const withLi = profiles.filter((p) => p.linkedin).length;
  console.error(`\nWrote ${OUT_DIR}/profiles.json, room.md, room.csv — LinkedIn for ${withLi}/${profiles.length}.`);
}

export { extractProfile, extractEmbeddedJson, handleUrl, resolveUserUrl, loadUrls };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
