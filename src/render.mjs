// Writes the rolodex as exactly two files:
//   out/people.md   — one block per person: profile, socials, bio, counts, and
//                     their hosted events as title + link (no descriptions here)
//   out/events.md   — every hosted event's description, collected in one place
//
// Pass { json: true } to emit people.json / events.json instead.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SOCIAL_KEYS = ["linkedin", "instagram", "twitter", "website", "youtube", "tiktok", "github"];
const SOCIAL_LABEL = { twitter: "x" };
const shortDate = (iso) => (iso ? iso.slice(0, 10) : "");

// --- collect unique hosted events across everyone --------------------------
function collectEvents(people) {
  const byId = new Map();
  for (const p of people) {
    for (const ev of p.hostedEvents || []) {
      if (!byId.has(ev.apiId)) {
        byId.set(ev.apiId, { ...ev, hosts: [] });
      }
      const host = p.name || p.username || p.profileUrl;
      const rec = byId.get(ev.apiId);
      if (!rec.hosts.includes(host)) rec.hosts.push(host);
    }
  }
  return [...byId.values()];
}

// --- markdown --------------------------------------------------------------
function peopleMd(people) {
  const ok = people.filter((p) => !p.error);
  const out = [`# Luma rolodex — ${ok.length} people`, `generated ${new Date().toISOString()}`, ``];
  for (const p of ok) {
    out.push(`## ${p.name || p.username || "(unknown)"}${p.verified ? " ✓" : ""}`);
    if (p.username) out.push(`- username: ${p.username}`);
    out.push(`- profile: ${p.profileUrl}`);
    for (const k of SOCIAL_KEYS) {
      if (p.socials?.[k]) out.push(`- ${SOCIAL_LABEL[k] || k}: ${p.socials[k]}`);
    }
    if (p.bio) out.push(`- bio: ${p.bio.replace(/\n+/g, " ")}`);
    out.push(`- events attended: ${p.attendedCount ?? "?"}`);
    out.push(`- events hosted: ${p.hostedCount ?? "?"}`);
    if (p.hostedEvents?.length) {
      out.push(`- hosted events:`);
      for (const ev of p.hostedEvents) out.push(`  - [${ev.name}](${ev.url})`);
    }
    out.push("");
  }
  const errs = people.filter((p) => p.error);
  if (errs.length) {
    out.push(`---`, ``, `## Could not fetch (${errs.length})`);
    for (const e of errs) out.push(`- ${e.profileUrl} — ${e.error}`);
    out.push("");
  }
  return out.join("\n");
}

function eventsMd(people) {
  const events = collectEvents(people);
  const withDesc = events.filter((e) => e.description);
  const out = [
    `# Hosted events — ${events.length} events`,
    `generated ${new Date().toISOString()} · ${withDesc.length} with descriptions`,
    ``,
  ];
  for (const ev of events) {
    out.push(`## ${ev.name}`);
    out.push(`- url: ${ev.url}`);
    if (ev.startAt) out.push(`- date: ${shortDate(ev.startAt)}`);
    if (ev.city) out.push(`- city: ${ev.city}`);
    out.push(`- host(s): ${ev.hosts.join(", ")}`);
    out.push("");
    if (ev.description) { out.push(ev.description, ""); }
    out.push(`---`, "");
  }
  return out.join("\n");
}

// --- json ------------------------------------------------------------------
function peopleJson(people) {
  return people.map((p) => p.error ? p : {
    name: p.name, username: p.username, profileUrl: p.profileUrl,
    socials: p.socials,
    bio: p.bio,
    attendedCount: p.attendedCount, hostedCount: p.hostedCount,
    hostedEvents: (p.hostedEvents || []).map((ev) => ({ name: ev.name, url: ev.url })),
  });
}

function eventsJson(people) {
  return collectEvents(people).map((ev) => ({
    name: ev.name, url: ev.url, apiId: ev.apiId,
    date: ev.startAt, city: ev.city, hosts: ev.hosts,
    description: ev.description ?? null,
  }));
}

export async function writeRolodex(people, { outDir = "out", json = false } = {}) {
  await mkdir(outDir, { recursive: true });
  if (json) {
    await writeFile(path.join(outDir, "people.json"), JSON.stringify(peopleJson(people), null, 2));
    await writeFile(path.join(outDir, "events.json"), JSON.stringify(eventsJson(people), null, 2));
    return { peopleFile: "people.json", eventsFile: "events.json" };
  }
  await writeFile(path.join(outDir, "people.md"), peopleMd(people));
  await writeFile(path.join(outDir, "events.md"), eventsMd(people));
  return { peopleFile: "people.md", eventsFile: "events.md" };
}
