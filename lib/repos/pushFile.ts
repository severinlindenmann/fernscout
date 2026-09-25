import { readStore, updateStore } from "../store";
import type { PushRepo, StoredSubscription } from "./types";

const FILE = "push-subscriptions";

type Subs = Record<string, StoredSubscription>;

const EMPTY: Subs = {};

/** The map key: a browser subscribing to two journals on one deployment must
 * not collide, so the key is the pair, not the endpoint alone — the same
 * reasoning as the database's `(owner_id, endpoint)` unique index. `\0` can't
 * appear in either half (a username is a path segment; an endpoint is a URL). */
function keyOf(username: string, endpoint: string): string {
  return `${username}\0${endpoint}`;
}

/** Read the raw map, keyed by `username\0endpoint`. */
async function readSubscriptions(): Promise<Subs> {
  return readStore<Subs>(FILE, EMPTY);
}

/** Push subscriptions on the JSON file store — the no-database deployment. */
export function filePushRepo(): PushRepo {
  return {
    async list(username) {
      // `kind` defaults to `"web"` the same way the database repo's does
      // (039-push-kind's column default) — every row written before B2115,
      // and every caller that still saves with no `kind` at all, is one.
      // The two backends must agree on what a subscription means; see this
      // file's own test in test/db-repos.test.ts.
      return Object.values(await readSubscriptions())
        .filter((s) => s.username === username)
        .map((s) => ({ ...s, kind: s.kind ?? "web" }));
    },

    async save(sub) {
      await updateStore<Subs>(FILE, EMPTY, (current) => {
        const key = keyOf(sub.username, sub.endpoint);
        const existing = current[key];
        return {
          ...current,
          [key]: {
            ...sub,
            // First seen wins: a browser refreshing its subscription should
            // not look like a reader who signed up today.
            created: existing?.created ?? sub.created,
            agent: sub.agent ?? existing?.agent,
            // A resubscribe that can't identify a contact (no guest session
            // this time) shouldn't erase one that was found before.
            contactId: sub.contactId !== undefined ? sub.contactId : (existing?.contactId ?? null),
          },
        };
      });
    },

    async remove(username, endpoints) {
      if (endpoints.length === 0) return;
      await updateStore<Subs>(FILE, EMPTY, (current) => {
        const next = { ...current };
        for (const e of endpoints) delete next[keyOf(username, e)];
        return next;
      });
    },
  };
}
