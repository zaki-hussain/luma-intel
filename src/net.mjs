// Cached, rate-limited HTTP for Luma. All network goes through one global
// limiter so we stay polite (bounded concurrency + minimum gap between starts).
// Responses are cached on disk so re-runs are instant and don't re-hit Luma.

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const cfg = { cacheDir: ".cache", delayMs: 1000, concurrency: 2, ua: DEFAULT_UA };

export function configure(opts = {}) {
  Object.assign(cfg, opts);
}

// --- global limiter -------------------------------------------------------
let active = 0;
let lastStart = 0;
const queue = [];

function pump() {
  if (active >= cfg.concurrency || queue.length === 0) return;
  const job = queue.shift();
  const gap = Math.max(0, lastStart + cfg.delayMs - Date.now());
  active++;
  setTimeout(async () => {
    lastStart = Date.now();
    try { job.resolve(await job.fn()); }
    catch (e) { job.reject(e); }
    finally { active--; pump(); }
    pump();
  }, gap);
}

function schedule(fn) {
  return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
}

// --- cache ----------------------------------------------------------------
async function cachePath(url) {
  await mkdir(cfg.cacheDir, { recursive: true });
  return path.join(cfg.cacheDir, createHash("sha1").update(url).digest("hex"));
}

async function readCache(file) {
  try { await stat(file); return await readFile(file, "utf8"); }
  catch { return null; }
}

// --- public ---------------------------------------------------------------
export async function getText(url, { useCache = true } = {}) {
  const file = await cachePath(url);
  if (useCache) {
    const hit = await readCache(file);
    if (hit != null) return { body: hit, cached: true, status: 200 };
  }
  return schedule(async () => {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": cfg.ua, accept: "text/html,application/json" },
    });
    const body = await res.text();
    if (res.ok) await writeFile(file, body);
    return { body, cached: false, status: res.status };
  });
}

export async function getJson(url, opts) {
  const { body, cached, status } = await getText(url, opts);
  try { return { data: JSON.parse(body), cached, status }; }
  catch { return { data: null, cached, status }; }
}
