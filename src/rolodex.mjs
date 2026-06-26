// Orchestrates building the rolodex: profile URLs -> enriched person records,
// optionally with the list of events each person has hosted and (optionally)
// each event's description.

import { fetchPerson, fetchHostedEvents, fetchEventDescription } from "./luma.mjs";

export async function buildRolodex(profileUrls, opts = {}) {
  const {
    includeEvents = false,        // fetch the list of hosted events
    includeDescriptions = false,  // also fetch each hosted event's description
    maxEventsPerPerson = 100,
    onProgress = () => {},
  } = opts;

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
        if (includeDescriptions) {
          for (const ev of person.hostedEvents) {
            try {
              const detail = await fetchEventDescription(ev.apiId);
              if (detail) ev.description = detail.description;
            } catch { /* leave description undefined */ }
          }
        }
      } catch { /* keep person without events */ }
    }

    onProgress(person, i, profileUrls.length);
    people.push(person);
  }
  return people;
}
