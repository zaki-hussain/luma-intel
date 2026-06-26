// Writes the rolodex of people as out/people.md (and exposes the same as JSON
// for the page). Each person block carries name, username, profile URL,
// LinkedIn / socials, bio, attended/hosted counts, and — when known — the list
// of your own events you've previously crossed paths with them at.
//
// NOTE: the per-event description file (out/events.md) belonged to the parked
// "hosted events" feature; that renderer is preserved (commented) at the bottom.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SOCIAL_KEYS = ["linkedin", "instagram", "twitter", "website", "youtube", "tiktok", "github"];
const SOCIAL_LABEL = { twitter: "x" };

export function peopleMd(people, { title } = {}) {
  const ok = people.filter((p) => !p.error);
  const heading = title ? `# ${title} — ${ok.length} people` : `# Luma rolodex — ${ok.length} people`;
  const out = [heading, `generated ${new Date().toISOString()}`, ``];
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
    if (p.seenAt?.length) {
      out.push(`- met before at: ${p.seenAt.map((e) => `[${e.name}](${e.url})`).join(", ")}`);
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

export function peopleJson(people) {
  return people.map((p) => p.error ? p : {
    name: p.name, username: p.username, profileUrl: p.profileUrl,
    socials: p.socials,
    bio: p.bio,
    attendedCount: p.attendedCount, hostedCount: p.hostedCount,
    seenAt: p.seenAt || [],
  });
}

export async function writeRolodex(people, { outDir = "out", title } = {}) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "people.md"), peopleMd(people, { title }));
  return { peopleFile: "people.md" };
}

// ===========================================================================
// PARKED — per-event descriptions renderer (out/events.md) for the hosted-
// events feature. Revive alongside the rolodex/luma changes if reintroduced.
// ---------------------------------------------------------------------------
//
// const shortDate = (iso) => (iso ? iso.slice(0, 10) : "");
//
// function collectEvents(people) {
//   const byId = new Map();
//   for (const p of people) for (const ev of p.hostedEvents || []) {
//     if (!byId.has(ev.apiId)) byId.set(ev.apiId, { ...ev, hosts: [] });
//     const host = p.name || p.username || p.profileUrl;
//     const rec = byId.get(ev.apiId);
//     if (!rec.hosts.includes(host)) rec.hosts.push(host);
//   }
//   return [...byId.values()];
// }
//
// function eventsMd(people) {
//   const events = collectEvents(people);
//   const out = [`# Hosted events — ${events.length} events`, ``];
//   for (const ev of events) {
//     out.push(`## ${ev.name}`, `- url: ${ev.url}`);
//     if (ev.startAt) out.push(`- date: ${shortDate(ev.startAt)}`);
//     if (ev.city) out.push(`- city: ${ev.city}`);
//     out.push(`- host(s): ${ev.hosts.join(", ")}`, "");
//     if (ev.description) out.push(ev.description, "");
//     out.push(`---`, "");
//   }
//   return out.join("\n");
// }
