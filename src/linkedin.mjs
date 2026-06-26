// LinkedIn enrichment.
//
// LinkedIn cannot be reliably scraped directly (auth wall + aggressive bot
// blocking + ToS). Two supported routes:
//
//   1. Deterministic, paid: a third-party enrichment API. We support Proxycurl
//      (set PROXYCURL_API_KEY). It takes the LinkedIn URL we already extracted
//      and returns structured work history + education.
//
//   2. Free, manual/AI-assisted: emit a "research packet" — one task per person
//      with the LinkedIn URL + context — that you paste into an AI agent with
//      web browsing (a separate tool) to fill in employer/education.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const PROXYCURL_ENDPOINT = "https://nubela.co/proxycurl/api/v2/linkedin";

export function hasProxycurl() {
  return !!process.env.PROXYCURL_API_KEY;
}

export async function enrichViaProxycurl(person, { delayMs = 1100 } = {}) {
  const url = person.socials?.linkedin;
  if (!url) return null;
  const params = new URLSearchParams({ url, use_cache: "if-present" });
  const res = await fetch(`${PROXYCURL_ENDPOINT}?${params}`, {
    headers: { Authorization: `Bearer ${process.env.PROXYCURL_API_KEY}` },
  });
  if (!res.ok) return { error: `proxycurl HTTP ${res.status}` };
  const d = await res.json();
  await new Promise((r) => setTimeout(r, delayMs));
  return {
    fullName: d.full_name || null,
    headline: d.headline || null,
    occupation: d.occupation || null,
    location: [d.city, d.country_full_name].filter(Boolean).join(", ") || null,
    experiences: (d.experiences || []).map((e) => ({
      company: e.company, title: e.title,
      start: e.starts_at ? `${e.starts_at.year}` : null,
      end: e.ends_at ? `${e.ends_at.year}` : "present",
    })),
    education: (d.education || []).map((e) => ({
      school: e.school, degree: e.degree_name, field: e.field_of_study,
    })),
  };
}

export async function enrichRolodexLinkedIn(people, { onProgress = () => {} } = {}) {
  for (const p of people) {
    if (p.error || !p.socials?.linkedin) continue;
    try { p.linkedinProfile = await enrichViaProxycurl(p); }
    catch (e) { p.linkedinProfile = { error: e.message }; }
    onProgress(p);
  }
  return people;
}

// --- free research packet -------------------------------------------------
export function buildResearchPacket(people) {
  const tasks = people
    .filter((p) => !p.error)
    .map((p) => ({
      name: p.name,
      linkedin: p.socials?.linkedin || null,
      profile: p.profileUrl,
      bio: p.bio || null,
      website: p.socials?.website || null,
      twitter: p.socials?.twitter || null,
      timezone: p.timezone || null,
      find: ["current_role", "current_company", "past_companies", "education", "location"],
    }));

  const jsonl = tasks.map((t) => JSON.stringify(t)).join("\n");

  const md = [
    `# LinkedIn research packet`,
    ``,
    `${tasks.length} people. Feed this to an AI agent with web browsing (a separate tool).`,
    `For each person, using the LinkedIn URL + context below, find: current role &`,
    `company, previous companies, education, and location. Return one JSON object`,
    `per person with those fields.`,
    ``,
    ...tasks.flatMap((t) => [
      `## ${t.name || "(unknown)"}`,
      `- linkedin: ${t.linkedin || "— (not on Luma profile; search by name + bio)"}`,
      t.bio ? `- bio: ${t.bio}` : null,
      t.website ? `- website: ${t.website}` : null,
      t.twitter ? `- twitter: ${t.twitter}` : null,
      t.timezone ? `- timezone: ${t.timezone}` : null,
      ``,
    ].filter((l) => l !== null)),
  ].join("\n");

  return { jsonl, md, count: tasks.length };
}

export async function writeResearchPacket(people, outDir = "out") {
  await mkdir(outDir, { recursive: true });
  const { jsonl, md, count } = buildResearchPacket(people);
  await writeFile(path.join(outDir, "linkedin-research.jsonl"), jsonl);
  await writeFile(path.join(outDir, "linkedin-research.md"), md);
  return count;
}
