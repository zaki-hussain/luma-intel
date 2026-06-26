#!/usr/bin/env node
/**
 * luma-intel · local server
 *
 * Serves index.html and runs the enrichment automatically in the background:
 * the page POSTs the captured guest list, the server builds the rolodex
 * (profiles first, then every hosted event's description), writes the two
 * markdown files to out/, and streams progress back to the page.
 *
 * The user never has to run `node enrich.mjs` by hand — just `npm start`.
 *
 *   npm start            # then open the printed URL
 *   PORT=8080 npm start  # pick a port
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configure } from "./src/net.mjs";
import { resolveUserUrl } from "./src/input.mjs";
import { buildRolodex } from "./src/rolodex.mjs";
import { writeRolodex, peopleJson, eventsJson } from "./src/render.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5178;

// in-memory jobs: id -> { status, progress, result, error }
const jobs = new Map();

function send(res, code, body, type = "application/json") {
  const payload = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function profileUrlsFrom(guests) {
  if (!Array.isArray(guests)) return [];
  const urls = guests.map((g) => (typeof g === "string" ? g : g?.profileUrl || g?.href || g?.url));
  return [...new Set(urls.map(resolveUserUrl).filter(Boolean))];
}

function startJob(guests) {
  const id = randomUUID();
  const job = {
    status: "running",
    progress: { phase: "profiles", done: 0, total: 0, message: "starting…" },
    result: null,
    error: null,
  };
  jobs.set(id, job);

  (async () => {
    const urls = profileUrlsFrom(guests);
    if (!urls.length) {
      job.status = "error";
      job.error = "No Luma /user/ profile links found in the pasted guest list.";
      return;
    }
    job.progress = { phase: "profiles", done: 0, total: urls.length, message: "reading profiles…" };
    configure({ delayMs: 1000, concurrency: 2 });

    const people = await buildRolodex(urls, {
      includeEvents: true,
      includeDescriptions: true,
      onProgress: (p, i, n) => {
        job.progress = {
          phase: "profiles",
          done: i + 1,
          total: n,
          message: p.error ? `skipped ${p.profileUrl}` : (p.name || p.profileUrl),
        };
      },
      onDescription: (done, total) => {
        job.progress = { phase: "descriptions", done, total, message: `event descriptions (${done}/${total})` };
      },
    });

    const { peopleFile, eventsFile } = await writeRolodex(people);
    job.status = "done";
    job.result = {
      people: peopleJson(people),
      events: eventsJson(people),
      files: { people: `out/${peopleFile}`, events: `out/${eventsFile}` },
    };
    job.progress = { phase: "done", done: people.length, total: people.length, message: "done" };
  })().catch((e) => {
    job.status = "error";
    job.error = e?.message || String(e);
  });

  return id;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(path.join(ROOT, "index.html"), "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    if (req.method === "POST" && url.pathname === "/api/enrich") {
      const body = await readBody(req);
      let guests;
      try { guests = JSON.parse(body).guests; } catch { return send(res, 400, { error: "invalid JSON" }); }
      const id = startJob(guests);
      return send(res, 202, { jobId: id });
    }

    const m = url.pathname.match(/^\/api\/enrich\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, { error: "unknown job" });
      return send(res, 200, {
        status: job.status,
        progress: job.progress,
        error: job.error,
        result: job.status === "done" ? job.result : null,
      });
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: e?.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`luma-intel running at http://localhost:${PORT}`);
  console.log("Open it, paste a Luma guest list, and the rolodex builds itself.");
});
