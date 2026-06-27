// Netlify Function: the one piece that must run on a server.
//
// Browsers can't fetch luma.com directly (no CORS), so this function fetches the
// page server-side and returns parsed JSON. It is completely stateless — all of
// the user's data (events, profile cache) lives in their browser. That means
// any visitor can just open the deployed site and use it with zero setup.
//
//   GET /api/luma?op=profile&url=https://luma.com/user/<handle>
//   GET /api/luma?op=event&url=https://lu.ma/<slug>

import { parseProfileHtml, buildPerson, parseEventMeta } from "../../src/luma.mjs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async function getHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": UA, accept: "text/html,application/json" },
  });
  return { body: await res.text(), status: res.status };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const op = url.searchParams.get("op");
  const target = url.searchParams.get("url");
  if (!target) return json({ error: "missing url" }, 400);

  try {
    if (op === "profile") {
      const { body, status } = await getHtml(target);
      const parsed = parseProfileHtml(body);
      if (!parsed) return json({ profileUrl: target, error: `no profile data (HTTP ${status})` });
      return json(buildPerson(target, parsed));
    }
    if (op === "event") {
      const { body } = await getHtml(target);
      return json(parseEventMeta(body, target));
    }
    return json({ error: "unknown op (use profile or event)" }, 400);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
};
