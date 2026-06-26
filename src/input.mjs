// Load Luma /user/ profile URLs from whatever the user has: the JSON exported by
// index.html, a raw copied guest-list .html file, or a plain list of URLs.

import { readFile } from "node:fs/promises";

const WEB_BASE = "https://luma.com";

export function resolveUserUrl(s) {
  if (!s) return null;
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      if (/^\/user\//.test(u.pathname)) return WEB_BASE + u.pathname.replace(/\/$/, "");
      return /lu\.ma|luma\.com/.test(u.hostname) ? s : null;
    }
  } catch { return null; }
  if (s.startsWith("/user/")) return WEB_BASE + s.replace(/\/$/, "");
  return null;
}

export async function loadProfileUrls(file) {
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
    const rel = raw.match(/\/user\/[^\s",]+/g) || [];
    urls = [...abs, ...rel];
  }
  return [...new Set(urls.map(resolveUserUrl).filter(Boolean))];
}
