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

// everyone across all saved events, ranked by how many of your events they
// attended (most frequent first), enriched from the profile cache when available
function rankPeople(store) {
  const byUrl = new Map();
  for (const ev of store.events) {
    for (const g of ev.guests) {
      if (!byUrl.has(g.profileUrl)) byUrl.set(g.profileUrl, { ...g, events: [] });
      byUrl.get(g.profileUrl).events.push({ id: ev.id, name: ev.name, url: ev.url });
    }
  }
  const people = [...byUrl.values()].map((p) => {
    const cached = store.people[p.profileUrl] || {};
    return {
      profileUrl: p.profileUrl,
      name: cached.name || p.name || p.username,
      username: cached.username || p.username,
      socials: cached.socials || {},
      bio: cached.bio || null,
      attendedCount: cached.attendedCount ?? null,
      hostedCount: cached.hostedCount ?? null,
      count: p.events.length,
      events: p.events,
    };
  });
  people.sort((a, b) => b.count - a.count || (a.name || "").localeCompare(b.name || ""));
  return people;
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
// Allow the page to be served from anywhere (e.g. your Netlify domain) while it
// talks to this server on localhost. No credentials are used, so "*" is fine.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};
function send(res, code, body, type = "application/json", headers = {}) {
  const payload = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", ...CORS, ...headers });
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

    // CORS preflight for cross-origin (e.g. Netlify-hosted) pages
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      const html = await readFile(path.join(ROOT, "index.html"), "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    // list saved events (reverse chronological)
    if (req.method === "GET" && pathname === "/api/events") {
      const store = await loadStore();
      return send(res, 200, { events: eventsSorted(store).map(summarize) });
    }

    // everyone you've met, ranked most-frequent first
    if (req.method === "GET" && pathname === "/api/people") {
      const store = await loadStore();
      return send(res, 200, { people: rankPeople(store) });
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
        // the hosts attended too — fold them into the guest list
        const allGuests = normGuests([...guests, ...meta.hosts]);
        const { hits, fetched } = await enrichGuests(allGuests.map((g) => g.profileUrl), store, job);
        const existing = store.events.find((e) => e.id === eventId);
        const record = { id: eventId, url: meta.url, name: meta.name, startAt: meta.startAt, city: meta.city,
                         addedAt: existing?.addedAt || new Date().toISOString(), guests: allGuests };
        if (existing) Object.assign(existing, record);
        else store.events.push(record);
        await saveStore(store);
        return { event: summarize(record),
                 stats: { hits, fetched, total: allGuests.length, hosts: meta.hosts.length } };
      });
      return send(res, 202, { jobId: id });
    }

    // backfill hosts for events saved before hosts were captured
    // body: { eventId } for one event, or {} for all of them
    if (req.method === "POST" && pathname === "/api/events/hosts") {
      const body = await readJson(req);
      const store = await loadStore();
      const targets = body?.eventId ? store.events.filter((e) => e.id === body.eventId) : store.events;
      if (!targets.length) return send(res, 404, { error: "no matching events" });

      const { id, job } = newJob(targets.length);
      run(job, async (job) => {
        const newUrls = new Set();
        let hostsAdded = 0;
        for (let i = 0; i < targets.length; i++) {
          const ev = targets[i];
          job.progress = { phase: "hosts", done: i, total: targets.length, message: `hosts for ${ev.name}` };
          const meta = await fetchEventMeta(ev.url);
          const had = new Set(ev.guests.map((g) => g.profileUrl));
          ev.guests = normGuests([...ev.guests, ...meta.hosts]);
          for (const g of ev.guests) if (!had.has(g.profileUrl)) { newUrls.add(g.profileUrl); hostsAdded++; }
        }
        const { hits, fetched } = await enrichGuests([...newUrls], store, job);
        await saveStore(store);
        return { events: targets.length, hostsAdded, hits, fetched };
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
          guests = normGuests([...guests, ...meta.hosts]); // hosts attended too
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
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", ...CORS,
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
