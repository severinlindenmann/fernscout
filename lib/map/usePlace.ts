/**
 * B-2996 — "Use this place on the map": the owner resolves a day's own typed
 * name through the address lookup, taps a candidate, and only `coordinates`
 * is written. Pure rules, shared by the phone sheet and the desktop list.
 */
export type PlaceCandidate = { displayName: string; country: string; lat: number; lon: number };

export const canOfferPlace = (day: { hasPlace: boolean; hidden?: boolean; location: string }, lookupOwner: boolean): boolean =>
  lookupOwner && !day.hasPlace && !day.hidden && day.location.trim() !== "";

/** The whole write: coordinates and nothing else. */
export const placePatch = (c: PlaceCandidate) => ({ coordinates: { lat: c.lat, lng: c.lon } });
