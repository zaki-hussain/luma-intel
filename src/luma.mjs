// High-level Luma access: turn a /user/ profile into structured data, and read
// an event page's metadata (name, date, city) from its public URL.
//
// NOTE: the "events someone has hosted" feature (fetchHostedEvents +
// fetchEventDescription) is currently unused — it lives, commented out, at the
// bottom of this file so it can be revived without reinventing it.

import { getText } from "./net.mjs";
// import { getJson } from "./net.mjs";                // needed by the parked hosted-events code
// import { mirrorToText } from "./prosemirror.mjs";   // needed by the parked event-description code

const WEB_BASE = "https://luma.com";
const API_BASE = "https://api.lu.ma";
const EVENT_BASE = "https://lu.ma";

// --- profile --------------------------------------------------------------
export function parseProfileHtml(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const init = data?.props?.pageProps?.initialData;
  if (!init || !init.user) return null;
  return { user: init.user, counts: init };
}

const SOCIAL_ORDER = ["linkedin", "twitter", "instagram", "website", "youtube", "tiktok", "github"];

function handleUrl(kind, h) {
  if (h == null || h === "") return null;
  if (/^https?:\/\//i.test(h)) return h;
  const v = String(h).trim().replace(/^@/, "");
  switch (kind) {
    case "linkedin": return "https://www.linkedin.com" + (v.startsWith("/") ? v : "/in/" + v);
    case "twitter": return "https://x.com/" + v.replace(/^\//, "");
    case "instagram": return "https://instagram.com/" + v.replace(/^\//, "");
    case "tiktok": return "https://www.tiktok.com/@" + v.replace(/^@?\/?/, "");
    case "youtube": return "https://www.youtube.com/" + v.replace(/^\//, "");
    case "github": return "https://github.com/" + v.replace(/^\//, "");
    default: return v;
  }
}

export function buildPerson(profileUrl, parsed) {
  const u = parsed.user;
  const socials = {};
  const add = (k, v) => { const url = handleUrl(k, v); if (url) socials[k] = url; };
  add("linkedin", u.linkedin_handle);
  add("twitter", u.twitter_handle);
  add("instagram", u.instagram_handle);
  add("youtube", u.youtube_handle);
  add("tiktok", u.tiktok_handle);
  add("github", u.github_handle);
  if (u.website) socials.website = u.website;

  const ordered = {};
  for (const k of SOCIAL_ORDER) if (socials[k]) ordered[k] = socials[k];

  return {
    name: (u.name || [u.first_name, u.last_name].filter(Boolean).join(" ") || "").replace(/\s+/g, " ").trim() || null,
    username: u.username || null,
    profileUrl,
    apiId: u.api_id || null,
    bio: (u.bio_short || "").trim() || null,
    timezone: u.timezone || null,
    verified: !!u.is_verified,
    attendedCount: parsed.counts.event_attended_count ?? null,
    hostedCount: parsed.counts.event_hosted_count ?? null,
    socials: ordered,
  };
}

export async function fetchPerson(profileUrl) {
  const { body, cached, status } = await getText(profileUrl);
  const parsed = parseProfileHtml(body);
  if (!parsed) return { profileUrl, error: `no profile data (HTTP ${status})` };
  const person = buildPerson(profileUrl, parsed);
  person._cached = cached;
  return person;
}

// --- event page metadata --------------------------------------------------
// Parse the public event page (https://lu.ma/<slug>) for its name/date/city so
// we can label a stored event nicely. Falls back to the slug if anything fails.
function eventSlug(url) {
  try {
    const u = new URL(url, EVENT_BASE);
    const seg = u.pathname.replace(/^\/+|\/+$/g, "");
    return seg || null;
  } catch { return null; }
}

// Hosts are full user objects on the event page; turn each into a guest-shaped
// record (a host obviously attended their own event).
function hostToGuest(h) {
  const handle = h.username || h.api_id;
  if (!handle) return null;
  const name = (h.name || [h.first_name, h.last_name].filter(Boolean).join(" ") || "").trim() || null;
  return { profileUrl: `${WEB_BASE}/user/${handle}`, name, username: h.username || null };
}

// Pure: parse an event page's HTML into metadata (no network).
export function parseEventMeta(html, eventUrl) {
  const slug = eventSlug(eventUrl);
  const canonical = slug ? `${EVENT_BASE}/${slug}` : eventUrl;
  let name = null, apiId = null, startAt = null, city = null, hosts = [];
  try {
    const m = (html || "").match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      const init = JSON.parse(m[1])?.props?.pageProps?.initialData;
      const root = init?.data || init || {};   // Luma wraps it as { kind, data } on some pages
      const e = root.event || {};
      name = e.name || null;
      apiId = e.api_id || root.api_id || null;
      startAt = e.start_at || root.start_at || null;
      city = e.geo_address_info?.city_state || e.geo_address_info?.city || root.featured_city || null;
      hosts = (root.hosts || []).map(hostToGuest).filter(Boolean);
    }
  } catch { /* fall back to slug */ }
  return { url: canonical, slug, name: name || slug || canonical, apiId, startAt, city, hosts };
}

export async function fetchEventMeta(eventUrl) {
  const slug = eventSlug(eventUrl);
  const canonical = slug ? `${EVENT_BASE}/${slug}` : eventUrl;
  let html = "";
  try { html = (await getText(canonical)).body; } catch { /* fall back to slug */ }
  return parseEventMeta(html, canonical);
}

export { WEB_BASE, API_BASE, EVENT_BASE };

// ===========================================================================
// PARKED — "events a person has hosted" + per-event descriptions.
//
// Not used by the current attendee-overlap flow. Kept (commented) so the
// feature can be revived without rebuilding the pagination + ProseMirror
// plumbing. To re-enable: uncomment, re-add `import { mirrorToText } from
// "./prosemirror.mjs";` at the top, and wire it back into rolodex.mjs.
// ---------------------------------------------------------------------------
//
// function normEvent(entry) {
//   const e = entry.event || entry;
//   return {
//     apiId: e.api_id,
//     name: e.name,
//     url: e.url ? `${EVENT_BASE}/${e.url}` : null,
//     slug: e.url || null,
//     startAt: e.start_at || entry.start_at || null,
//     timezone: e.timezone || null,
//     city: e.geo_address_info?.city_state || e.geo_address_info?.city || entry.featured_city || null,
//     coverUrl: e.cover_url || null,
//     guestCount: entry.guest_count ?? null,
//   };
// }
//
// export async function fetchHostedEvents(apiId, { period = "past", max = 100 } = {}) {
//   if (!apiId) return [];
//   const events = [];
//   let cursor = null;
//   for (let page = 0; page < 20 && events.length < max; page++) {
//     const params = new URLSearchParams({ user_api_id: apiId, period, pagination_limit: "20" });
//     if (cursor) params.set("pagination_cursor", cursor);
//     const { data } = await getJson(`${API_BASE}/user/profile/events-hosting?${params}`);
//     if (!data || !Array.isArray(data.entries)) break;
//     for (const entry of data.entries) events.push(normEvent(entry));
//     if (!data.has_more || !data.next_cursor) break;
//     cursor = data.next_cursor;
//   }
//   return events.slice(0, max);
// }
//
// export async function fetchEventDescription(eventApiId) {
//   const { data } = await getJson(`${API_BASE}/event/get?event_api_id=${encodeURIComponent(eventApiId)}`);
//   if (!data) return null;
//   const text = mirrorToText(data.description_mirror);
//   return {
//     name: data.event?.name || null,
//     description: text || null,
//     calendar: data.calendar?.name || null,
//     guestCount: data.guest_count ?? null,
//   };
// }
