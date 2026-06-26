#!/usr/bin/env node
/**
 * luma-intel · local server
 *
 * A personal log of the Luma events you've been to, used to spot familiar faces
 * at events you're considering:
 *
 *   1. Paste an event URL + its guest list to SAVE an event you attended.
 *   2. CHECK an event (a new one you paste, or one you saved) to see which of
 *      its guests you've already been to an event with — and get the enriched
 *      profiles (LinkedIn, socials, bio) as copy/download-ready markdown.
 *
 * Enrichment runs automatically in the background; the user never runs a
 * command by hand. Your saved events live in data/events.json.
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

// --- persistent event store ------------------------------------------------
async function loadStore() {
  try { return JSON.parse(await readFile(STORE_FILE, "utf8")); }
  catch { return { events: [] }; }
}
async function saveStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2));
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

// --- http helpers ------------------------------------------------------------
function send(res, code, body, type = "application/json") {
  const payload = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(payload);
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { return null; }
}

// --- analyze jobs ------------------------------------------------------------
const jobs = new Map();

function startAnalyze({ guests, targetEvent, store }) {
  const id = randomUUID();
  const job = {
    status: "running",
    progress: { phase: "profiles", done: 0, total: guests.length, message: "reading profiles…" },
    result: null,
    error: null,
  };
  jobs.set(id, job);

  (async () => {
    // index: profileUrl -> list of stored events that person appeared at
    // (excluding the event we're checking, so we report *other* shared events)
    const seenIndex = new Map();
    for (const ev of store.events) {
      if (targetEvent && ev.id === targetEvent.id) continue;
      for (const g of ev.guests) {
        if (!seenIndex.has(g.profileUrl)) seenIndex.set(g.profileUrl, []);
        seenIndex.get(g.profileUrl).push({ id: ev.id, name: ev.name, url: ev.url });
      }
    }

    const urls = guests.map((g) => g.profileUrl);
    configure({ delayMs: 1000, concurrency: 2 });
    const people = await buildRolodex(urls, {
      onProgress: (p, i, n) => {
        job.progress = { phase: "profiles", done: i + 1, total: n,
                         message: p.error ? `skipped ${p.profileUrl}` : (p.name || p.profileUrl) };
      },
    });

    for (const p of people) {
      if (p.error) continue;
      p.seenAt = seenIndex.get(p.profileUrl) || [];
    }

    const title = targetEvent?.name || "Luma rolodex";
    const { peopleFile } = await writeRolodex(people, { title });
    const known = people.filter((p) => !p.error && p.seenAt?.length).length;

    job.status = "done";
    job.result = {
      event: targetEvent ? summarize(targetEvent) : null,
      people: peopleJson(people),
      markdown: peopleMd(people, { title }),
      files: { people: `out/${peopleFile}` },
      stats: { total: people.length, resolved: people.filter((p) => !p.error).length, known },
    };
    job.progress = { phase: "done", done: people.length, total: people.length, message: "done" };
  })().catch((e) => { job.status = "error"; job.error = e?.message || String(e); });

  return id;
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

    // list saved events
    if (req.method === "GET" && pathname === "/api/events") {
      const store = await loadStore();
      return send(res, 200, { events: store.events.map(summarize) });
    }

    // save an attended event (url + guest list)
    if (req.method === "POST" && pathname === "/api/events") {
      const body = await readJson(req);
      if (!body?.url) return send(res, 400, { error: "missing event url" });
      const guests = normGuests(body.guests);
      if (!guests.length) return send(res, 400, { error: "no Luma /user/ profiles found in the guest list" });

      const meta = await fetchEventMeta(body.url);
      const id = meta.slug || meta.url;
      const store = await loadStore();
      const existing = store.events.find((e) => e.id === id);
      const record = { id, url: meta.url, name: meta.name, startAt: meta.startAt, city: meta.city,
                       addedAt: existing?.addedAt || new Date().toISOString(), guests };
      if (existing) Object.assign(existing, record);
      else store.events.unshift(record);
      await saveStore(store);
      return send(res, 200, { event: summarize(record) });
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
            || { id, url: meta.url, name: meta.name, startAt: meta.startAt, city: meta.city };
        }
      }
      const id = startAnalyze({ guests, targetEvent, store });
      return send(res, 202, { jobId: id });
    }

    const job = pathname.match(/^\/api\/analyze\/([\w-]+)$/);
    if (req.method === "GET" && job) {
      const j = jobs.get(job[1]);
      if (!j) return send(res, 404, { error: "unknown job" });
      return send(res, 200, { status: j.status, progress: j.progress, error: j.error,
                              result: j.status === "done" ? j.result : null });
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
