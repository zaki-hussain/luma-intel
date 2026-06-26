#!/usr/bin/env node
/**
 * luma-intel · local server
 *
 * A personal log of the Luma events you've been to, used to spot familiar faces
 * at events you're considering:
 *
 *   1. Paste an event URL + its guest list to SAVE an event you attended. Saving
 *      resolves every guest's profile (LinkedIn, socials, bio) right away.
 *   2. CHECK an event (a new one you paste, or one you saved) to see which of its
 *      guests you've already been to an event with — plus the enriched profiles
 *      as copy/download-ready markdown.
 *
 * Resolved profiles are cached (keyed by Luma profile URL) in data/events.json,
 * so a guest seen before is never re-fetched — only their shared-event history
 * is recomputed. Use Export / Import to back up or restore everything.
 *
 *   npm start            # then open the printed URL
 *   PORT=8080 npm start  # pick a port
 */

import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configure } from "./src/net.mjs";
import { resolveUserUrl } from "./src/input.mjs";
import { fetchEventMeta } from "./src/luma.mjs";
import { buildRolodex } from "./src/rolodex.mjs";
import { writeRolodex, peopleJson, peopleMd } from "./src/render.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5178;
const DATA_DIR = path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "events.json");

// --- persistent store: { events: [...], people: { <profileUrl>: person } } ---
async function loadStore() {
  try {
    const s = JSON.parse(await readFile(STORE_FILE, "utf8"));
    s.events ||= [];
    s.people ||= {};
    return s;
  } catch { return { events: [], people: {} }; }
}
async function saveStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2));
}

// reverse-chronological by event date, newest first (fall back to added time)
function eventsSorted(store) {
  return [...store.events].sort((a, b) =>
    (b.startAt || b.addedAt || "").localeCompare(a.startAt || a.addedAt || ""));
}
function summarize(ev) {
  return { id: ev.id, url: ev.url, name: ev.name, startAt: ev.startAt, city: ev.city,
           guestCount: ev.guests ? ev.guests.length : (ev.guestCount ?? 0), addedAt: ev.addedAt };
}

function normGuests(guests) {
  if (!Array.isArray(guests)) return [];
  const byUrl = new Map();
  for (const g of guests) {
    const profileUrl = resolveUserUrl(typeof g === "string" ? g : g?.profileUrl || g?.href || g?.url);
    if (!profileUrl || byUrl.has(profileUrl)) continue;
    byUrl.set(profileUrl, {
      profileUrl,
      name: (typeof g === "object" && g?.name) ? g.name : null,
      username: profileUrl.replace("https://luma.com/user/", ""),
    });
  }
  return [...byUrl.values()];
}

// only the fields worth caching long-term
function cleanPerson(p) {
  return { name: p.name, username: p.username, profileUrl: p.profileUrl,
           bio: p.bio, verified: p.verified,
           attendedCount: p.attendedCount, hostedCount: p.hostedCount, socials: p.socials };
}

// --- http helpers ------------------------------------------------------------
function send(res, code, body, type = "application/json", headers = {}) {
  const payload = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", ...headers });
  res.end(payload);
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { return null; }
}

// --- background jobs ---------------------------------------------------------
const jobs = new Map();
function newJob(total = 0) {
  const id = randomUUID();
  const job = { status: "running", progress: { phase: "profiles", done: 0, total, message: "starting…" },
                result: null, error: null };
  jobs.set(id, job);
  return { id, job };
}
function run(job, fn) {
  fn(job)
    .then((result) => { job.result = result; job.status = "done";
                        job.progress = { ...job.progress, phase: "done", message: "done" }; })
    .catch((e) => { job.status = "error"; job.error = e?.message || String(e); });
}

// Resolve profiles, reusing anyone already cached in the store; newly fetched
// profiles are written back into the cache. Returns people in input order.
async function enrichGuests(profileUrls, store, job) {
  const cache = new Map(Object.entries(store.people));
  let hits = 0, fetched = 0;
  const people = await buildRolodex(profileUrls, {
    cache,
    onResolved: (p) => { store.people[p.profileUrl] = cleanPerson(p); },
    onProgress: (p, i, n, cached) => {
      if (cached) hits++; else fetched++;
      job.progress = { phase: "profiles", done: i + 1, total: n,
                       message: `${cached ? "cached " : ""}${p.name || p.profileUrl}` };
    },
  });
  return { people, hits, fetched };
}

// --- routes ------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      const html = await readFile(path.join(ROOT, "index.html"), "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    // list saved events (reverse chronological)
    if (req.method === "GET" && pathname === "/api/events") {
      const store = await loadStore();
      return send(res, 200, { events: eventsSorted(store).map(summarize) });
    }

    // save an attended event (url + guest list) — resolves profiles in the background
    if (req.method === "POST" && pathname === "/api/events") {
      const body = await readJson(req);
      if (!body?.url) return send(res, 400, { error: "missing event url" });
      const guests = normGuests(body.guests);
      if (!guests.length) return send(res, 400, { error: "no Luma /user/ profiles found in the guest list" });

      const store = await loadStore();
      const { id, job } = newJob(guests.length);
      run(job, async (job) => {
        const meta = await fetchEventMeta(body.url);
        const eventId = meta.slug || meta.url;
        const { hits, fetched } = await enrichGuests(guests.map((g) => g.profileUrl), store, job);
        const existing = store.events.find((e) => e.id === eventId);
        const record = { id: eventId, url: meta.url, name: meta.name, startAt: meta.startAt, city: meta.city,
                         addedAt: existing?.addedAt || new Date().toISOString(), guests };
        if (existing) Object.assign(existing, record);
        else store.events.push(record);
        await saveStore(store);
        return { event: summarize(record), stats: { hits, fetched, total: guests.length } };
      });
      return send(res, 202, { jobId: id });
    }

    // delete a saved event
    const del = pathname.match(/^\/api\/events\/(.+)$/);
    if (req.method === "DELETE" && del) {
      const id = decodeURIComponent(del[1]);
      const store = await loadStore();
      const before = store.events.length;
      store.events = store.events.filter((e) => e.id !== id);
      await saveStore(store);
      return send(res, 200, { removed: before - store.events.length });
    }

    // analyze: who at this event have I already been to an event with?
    if (req.method === "POST" && pathname === "/api/analyze") {
      const body = await readJson(req);
      const store = await loadStore();
      let guests, targetEvent = null;

      if (body?.eventId) {
        targetEvent = store.events.find((e) => e.id === body.eventId);
        if (!targetEvent) return send(res, 404, { error: "unknown saved event" });
        guests = targetEvent.guests;
      } else {
        guests = normGuests(body?.guests);
        if (!guests.length) return send(res, 400, { error: "no Luma /user/ profiles found in the guest list" });
        if (body?.url) {
          const meta = await fetchEventMeta(body.url);
          const id = meta.slug || meta.url;
          targetEvent = store.events.find((e) => e.id === id)
            || { id, url: meta.url, name: meta.name, startAt: meta.startAt, city: meta.city, guestCount: guests.length };
        }
      }

      const { id, job } = newJob(guests.length);
      run(job, async (job) => {
        // index: profileUrl -> other stored events that person appeared at
        const seenIndex = new Map();
        for (const ev of store.events) {
          if (targetEvent && ev.id === targetEvent.id) continue;
          for (const g of ev.guests) {
            if (!seenIndex.has(g.profileUrl)) seenIndex.set(g.profileUrl, []);
            seenIndex.get(g.profileUrl).push({ id: ev.id, name: ev.name, url: ev.url });
          }
        }

        const { people } = await enrichGuests(guests.map((g) => g.profileUrl), store, job);
        await saveStore(store); // persist any newly cached profiles
        for (const p of people) { if (!p.error) p.seenAt = seenIndex.get(p.profileUrl) || []; }

        const title = targetEvent?.name || "Luma rolodex";
        const { peopleFile } = await writeRolodex(people, { title });
        const known = people.filter((p) => !p.error && p.seenAt?.length).length;
        return {
          event: targetEvent ? summarize(targetEvent) : null,
          people: peopleJson(people),
          markdown: peopleMd(people, { title }),
          files: { people: `out/${peopleFile}` },
          stats: { total: people.length, resolved: people.filter((p) => !p.error).length, known },
        };
      });
      return send(res, 202, { jobId: id });
    }

    // poll any background job
    const jobMatch = pathname.match(/^\/api\/job\/([\w-]+)$/);
    if (req.method === "GET" && jobMatch) {
      const j = jobs.get(jobMatch[1]);
      if (!j) return send(res, 404, { error: "unknown job" });
      return send(res, 200, { status: j.status, progress: j.progress, error: j.error,
                              result: j.status === "done" ? j.result : null });
    }

    // export everything (events + cached profiles) as a downloadable backup
    if (req.method === "GET" && pathname === "/api/export") {
      const store = await loadStore();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store",
                           "content-disposition": 'attachment; filename="luma-intel-backup.json"' });
      return res.end(JSON.stringify(store, null, 2));
    }

    // import a previously exported backup (replaces the store)
    if (req.method === "POST" && pathname === "/api/import") {
      const body = await readJson(req);
      if (!body || !Array.isArray(body.events)) return send(res, 400, { error: "invalid backup file" });
      const store = { events: body.events, people: body.people && typeof body.people === "object" ? body.people : {} };
      await saveStore(store);
      return send(res, 200, { events: store.events.length, people: Object.keys(store.people).length });
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: e?.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`luma-intel running at http://localhost:${PORT}`);
  console.log("Save the events you've been to, then check a new event for familiar faces.");
});
