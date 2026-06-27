#!/usr/bin/env node
/**
 * luma-intel · local dev server
 *
 * For running the app locally without Netlify. It serves index.html and exposes
 * the same single stateless endpoint the deployed app uses:
 *
 *   GET /api/luma?op=profile&url=https://luma.com/user/<handle>
 *   GET /api/luma?op=event&url=https://lu.ma/<slug>
 *
 * All of the user's data (events, profile cache) lives in the browser
 * (localStorage) — this server keeps no state. CORS is permissive so the page
 * can also be hosted elsewhere (e.g. your own domain) while calling this
 * server on localhost (load it with ?api=http://localhost:5178).
 *
 *   npm start            # then open the printed URL
 *   PORT=8080 npm start  # pick a port
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseProfileHtml, buildPerson, parseEventMeta } from "./src/luma.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5178;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

async function getHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": UA, accept: "text/html,application/json" },
  });
  return { body: await res.text(), status: res.status };
}

const server = http.createServer(async (req, res) => {
  const json = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...CORS });
    res.end(JSON.stringify(obj));
  };
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(path.join(ROOT, "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(html);
    }

    if (req.method === "GET" && url.pathname === "/api/luma") {
      const op = url.searchParams.get("op");
      const target = url.searchParams.get("url");
      if (!target) return json(400, { error: "missing url" });
      if (op === "profile") {
        const { body, status } = await getHtml(target);
        const parsed = parseProfileHtml(body);
        if (!parsed) return json(200, { profileUrl: target, error: `no profile data (HTTP ${status})` });
        return json(200, buildPerson(target, parsed));
      }
      if (op === "event") {
        const { body } = await getHtml(target);
        return json(200, parseEventMeta(body, target));
      }
      return json(400, { error: "unknown op (use profile or event)" });
    }

    return json(404, { error: "not found" });
  } catch (e) {
    return json(500, { error: e?.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`luma-intel running at http://localhost:${PORT}`);
  console.log("Open it, save the events you've been to, then check a new event for familiar faces.");
});
