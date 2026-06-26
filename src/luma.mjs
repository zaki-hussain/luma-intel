// High-level Luma access: turn a /user/ profile into structured data, list the
// events someone has hosted, and fetch a single event's details/description.

import { getText, getJson } from "./net.mjs";
import { mirrorToText } from "./prosemirror.mjs";

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
    hostedEvents: [],
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

// --- hosted events --------------------------------------------------------
function normEvent(entry) {
  const e = entry.event || entry;
  return {
    apiId: e.api_id,
    name: e.name,
    url: e.url ? `${EVENT_BASE}/${e.url}` : null,
    slug: e.url || null,
    startAt: e.start_at || entry.start_at || null,
    timezone: e.timezone || null,
    city: e.geo_address_info?.city_state || e.geo_address_info?.city || entry.featured_city || null,
    coverUrl: e.cover_url || null,
    guestCount: entry.guest_count ?? null,
  };
}

export async function fetchHostedEvents(apiId, { period = "past", max = 100 } = {}) {
  if (!apiId) return [];
  const events = [];
  let cursor = null;
  for (let page = 0; page < 20 && events.length < max; page++) {
    const params = new URLSearchParams({ user_api_id: apiId, period, pagination_limit: "20" });
    if (cursor) params.set("pagination_cursor", cursor);
    const { data } = await getJson(`${API_BASE}/user/profile/events-hosting?${params}`);
    if (!data || !Array.isArray(data.entries)) break;
    for (const entry of data.entries) events.push(normEvent(entry));
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return events.slice(0, max);
}

// --- single event ---------------------------------------------------------
export async function fetchEventDescription(eventApiId) {
  const { data } = await getJson(`${API_BASE}/event/get?event_api_id=${encodeURIComponent(eventApiId)}`);
  if (!data) return null;
  const text = mirrorToText(data.description_mirror);
  return {
    name: data.event?.name || null,
    description: text || null,
    calendar: data.calendar?.name || null,
    guestCount: data.guest_count ?? null,
  };
}

export { WEB_BASE, API_BASE, EVENT_BASE };
