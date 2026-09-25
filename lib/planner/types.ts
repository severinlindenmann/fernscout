/**
 * The wire shapes B2011's planner reads and writes — shaped exactly like
 * `plan`/`costItem` in `lib/api/v2/schemas/trip.ts` and `day.ts`. Kept here,
 * client-safe, rather than importing the Zod schemas themselves: those pull
 * in server-only validation machinery this bundle never needs, and every
 * field below is a plain mirror of one already documented there.
 */

import type { CostCategory } from "@/lib/costFormat";

type PlanSee = { name: string; lat: number; lng: number; source?: string };

export type PlanStop = {
  id?: string;
  location: string;
  lat: number;
  lng: number;
  country?: string;
  countryCode?: string;
  note?: string;
  nights?: number;
  arrive?: string;
  leave?: string;
  see?: PlanSee[];
  source?: string;
};

type PlanLink = { label: string; url: string };

type PlanPrivateStop = {
  stay?: { name: string; lat: number; lng: number };
  links?: PlanLink[];
};

type PlanPrivate = {
  links?: PlanLink[];
  stops?: Record<string, PlanPrivateStop>;
};

export type PlanDoc = {
  route: PlanStop[];
  body?: string;
  mode?: "nights" | "dates";
  readers?: "map" | "details";
  private?: PlanPrivate;
};

type CostItem = {
  label: string;
  amount: number;
  category?: CostCategory;
  currency?: string;
  stop?: string;
};

export type CostsDoc = {
  budget?: { total: number; days?: number; currency?: string };
  items?: CostItem[];
  note?: string;
  visibility?: "public" | "guests";
};

/** `POST /api/helper/[user]/plan/read`'s own answer shape — B2010. */
export type ParsedThing =
  | { kind: "place"; lat: number; lng: number; name?: string; country?: string; countryCode?: string; source: string }
  | { kind: "link"; url: string; title: string | null }
  | { kind: "coordinates"; lat: number; lng: number; country?: string; countryCode?: string }
  | { kind: "cost"; amount: number; currency?: string; label: string; category?: CostCategory }
  | { kind: "place-query"; q: string };

/** `GET /api/helper/[user]/plan/search`'s own answer shape — a name search's
 * candidates, same fields `geocodePlace` (`lib/addressLookup.ts`) returns. */
export type PlaceCandidate = {
  displayName: string;
  country: string;
  countryCode?: string;
  adminRegion?: string;
  lat: number;
  lon: number;
  type?: string;
};

// B2338 retired `PendingPin` (was: one WhatsApp pin waiting in the inbox, as
// the planner offered it — B2014) along with the Composer card that showed
// it. `WaitingPin`/`listWaitingPins`/`removeWaitingPin` (`lib/inbox.ts`) stay
// — B2013's own tests still exercise them, and the write side
// (`handleLocationPin`, `paid/whatsapp/lib/whatsapp/dispatch.ts`) is dormant
// rather than deleted, same as the rest of that ticket's code.
