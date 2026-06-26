// Writes the rolodex to disk: machine-readable JSON, a readable per-person
// markdown outline, a flat CSV, and one markdown file per hosted event whose
// description we fetched.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

function csvCell(v = "") {
  v = String(v ?? "");
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function shortDate(iso) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function toMarkdown(people) {
  const ok = people.filter((p) => !p.error);
  const out = [
    `# Luma rolodex`,
    ``,
    `${ok.length} people · generated ${new Date().toISOString()}`,
    `LinkedIn for ${ok.filter((p) => p.socials?.linkedin).length}/${ok.length}.`,
    ``,
  ];
  for (const p of ok) {
    out.push(`## ${p.name || p.username || "(unknown)"}${p.verified ? " ✓" : ""}`);
    out.push(`- linkedin: ${p.socials?.linkedin || "— (none on profile)"}`);
    out.push(`- profile: ${p.profileUrl}${p.username ? `  (@${p.username})` : ""}`);
    for (const k of ["twitter", "instagram", "website", "youtube", "tiktok", "github"]) {
      if (p.socials?.[k]) out.push(`- ${k}: ${p.socials[k]}`);
    }
    if (p.bio) out.push(`- bio: ${p.bio}`);
    out.push(`- events: hosted ${p.hostedCount ?? "?"}, attended ${p.attendedCount ?? "?"}`);
    if (p.timezone) out.push(`- timezone: ${p.timezone}`);
    if (p.hostedEvents?.length) {
      out.push(`- hosted events:`);
      for (const ev of p.hostedEvents) {
        const bits = [shortDate(ev.startAt), ev.city].filter(Boolean).join(", ");
        out.push(`  - [${ev.name}](${ev.url})${bits ? ` — ${bits}` : ""}`);
      }
    }
    out.push("");
  }
  return out.join("\n");
}

export function toCsv(people) {
  const header = "name,linkedin,twitter,instagram,website,youtube,profileUrl,username,bio,hostedCount,attendedCount,timezone";
  const rows = people.filter((p) => !p.error).map((p) => [
    p.name, p.socials?.linkedin, p.socials?.twitter, p.socials?.instagram, p.socials?.website, p.socials?.youtube,
    p.profileUrl, p.username, p.bio, p.hostedCount, p.attendedCount, p.timezone,
  ].map(csvCell).join(","));
  return [header, ...rows].join("\n");
}

export async function writeRolodex(people, outDir = "out") {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "rolodex.json"), JSON.stringify(people, null, 2));
  await writeFile(path.join(outDir, "room.md"), toMarkdown(people));
  await writeFile(path.join(outDir, "room.csv"), toCsv(people));

  // one file per hosted event that has a description
  const eventsDir = path.join(outDir, "events");
  let eventFiles = 0;
  const seen = new Set();
  for (const p of people) {
    for (const ev of p.hostedEvents || []) {
      if (!ev.description || seen.has(ev.apiId)) continue;
      seen.add(ev.apiId);
      await mkdir(eventsDir, { recursive: true });
      const fname = (ev.slug || ev.apiId).replace(/[^a-z0-9_-]/gi, "_") + ".md";
      const body = [
        `# ${ev.name}`,
        ``,
        `- url: ${ev.url}`,
        ev.startAt ? `- date: ${ev.startAt}` : null,
        ev.city ? `- city: ${ev.city}` : null,
        `- host: ${p.name || p.username} (${p.profileUrl})`,
        ``,
        ev.description,
        ``,
      ].filter((l) => l !== null).join("\n");
      await writeFile(path.join(eventsDir, fname), body);
      eventFiles++;
    }
  }
  return { people: people.length, eventFiles };
}
