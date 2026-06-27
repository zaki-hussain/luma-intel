// Orchestrates building the rolodex: profile URLs -> enriched person records
// (name, Luma profile, LinkedIn + socials, bio, attended/hosted counts).
//
// NOTE: the old behaviour also walked each person's hosted events and fetched
// their descriptions in a deliberate second pass. That feature is currently
// unused; the two-pass logic is preserved (commented) at the bottom of this
// file so it can be revived without reinventing it.

import { fetchPerson } from "./luma.mjs";

// opts:
//   onProgress(person, index, total, cached)  — after each profile
//   cache        Map<profileUrl, person>      — already-resolved profiles to reuse
//   onResolved(person)                         — fired only for freshly fetched profiles
export async function buildRolodex(profileUrls, opts = {}) {
  const { onProgress = () => {}, cache = null, onResolved = () => {} } = opts;

  const people = [];
  for (let i = 0; i < profileUrls.length; i++) {
    const url = profileUrls[i];
    let person, cached = false;
    if (cache && cache.has(url)) {
      person = cache.get(url);
      cached = true;
    } else {
      try {
        person = await fetchPerson(url);
      } catch (e) {
        person = { profileUrl: url, error: e.message };
      }
      if (!person.error) { onResolved(person); cache?.set(url, person); }
    }
    onProgress(person, i, profileUrls.length, cached);
    people.push(person);
  }
  return people;
}

// ===========================================================================
// PARKED — hosted events + descriptions, fetched only after every profile is
// walked. Re-enable by importing { fetchHostedEvents, fetchEventDescription }
// from "./luma.mjs" (uncomment them there too) and folding this back in.
// ---------------------------------------------------------------------------
//
//   const {
//     includeEvents = false,        // fetch the list of hosted events
//     includeDescriptions = false,  // also fetch each hosted event's description
//     maxEventsPerPerson = 100,
//     onProgress = () => {},
//     onDescription = () => {},     // (done, total) after each event description
//   } = opts;
//
//   // pass 1: every profile (and its hosted-event list)
//   for (...) {
//     if (!person.error && includeEvents && person.hostedCount > 0 && person.apiId) {
//       try { person.hostedEvents = await fetchHostedEvents(person.apiId, { period: "past", max: maxEventsPerPerson }); }
//       catch { /* keep person without events */ }
//     }
//   }
//
//   // pass 2: descriptions, only after all profiles are walked
//   if (includeDescriptions) {
//     const byId = new Map();
//     for (const p of people) for (const ev of p.hostedEvents || []) {
//       if (!ev.apiId) continue;
//       if (!byId.has(ev.apiId)) byId.set(ev.apiId, []);
//       byId.get(ev.apiId).push(ev);
//     }
//     const ids = [...byId.keys()];
//     let done = 0;
//     for (const apiId of ids) {
//       let description;
//       try { const detail = await fetchEventDescription(apiId); if (detail) description = detail.description; }
//       catch { /* leave undefined */ }
//       if (description != null) for (const ev of byId.get(apiId)) ev.description = description;
//       onDescription(++done, ids.length);
//     }
//   }
