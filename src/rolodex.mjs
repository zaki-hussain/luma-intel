// Orchestrates building the rolodex: profile URLs -> enriched person records,
// optionally with the list of events each person has hosted and (optionally)
// each event's description.
//
// Descriptions are fetched in a deliberate second pass: we walk every profile
// first, and only once all profiles are done do we go into the hosted events'
// descriptions. Each unique event is fetched once and the result fanned out to
// everyone who hosted it.

import { fetchPerson, fetchHostedEvents, fetchEventDescription } from "./luma.mjs";

export async function buildRolodex(profileUrls, opts = {}) {
  const {
    includeEvents = false,        // fetch the list of hosted events
    includeDescriptions = false,  // also fetch each hosted event's description
    maxEventsPerPerson = 100,
    onProgress = () => {},        // (person, index, total) after each profile
    onDescription = () => {},     // (done, total) after each event description
  } = opts;

  // --- pass 1: every profile (and its hosted-event list) ------------------
  const people = [];
  for (let i = 0; i < profileUrls.length; i++) {
    const url = profileUrls[i];
    let person;
    try {
      person = await fetchPerson(url);
    } catch (e) {
      person = { profileUrl: url, error: e.message };
    }

    if (!person.error && includeEvents && person.hostedCount > 0 && person.apiId) {
      try {
        person.hostedEvents = await fetchHostedEvents(person.apiId, { period: "past", max: maxEventsPerPerson });
      } catch { /* keep person without events */ }
    }

    onProgress(person, i, profileUrls.length);
    people.push(person);
  }

  // --- pass 2: descriptions, only after all profiles are walked -----------
  if (includeDescriptions) {
    // unique event ids -> the event objects (across people) that share them
    const byId = new Map();
    for (const p of people) {
      for (const ev of p.hostedEvents || []) {
        if (!ev.apiId) continue;
        if (!byId.has(ev.apiId)) byId.set(ev.apiId, []);
        byId.get(ev.apiId).push(ev);
      }
    }

    const ids = [...byId.keys()];
    let done = 0;
    for (const apiId of ids) {
      let description;
      try {
        const detail = await fetchEventDescription(apiId);
        if (detail) description = detail.description;
      } catch { /* leave description undefined */ }
      if (description != null) {
        for (const ev of byId.get(apiId)) ev.description = description;
      }
      onDescription(++done, ids.length);
    }
  }

  return people;
}
