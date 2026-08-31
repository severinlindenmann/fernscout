import "server-only";
import fs from "node:fs";
import path from "node:path";
import { clearConfigCache } from "./config";
import { contentRoot } from "./contentRoot";
import { clearUserCache, getUsernames, isReservedUsername, isValidUsername } from "./users";

/**
 * Creating a journal — the one thing an agent could not do.
 *
 * Until now the first step of using this software was making a directory on a
 * server, which is fine for the person who runs the server and impossible for
 * everybody else. An agent could write days into a journal that already
 * existed and nothing more, so "set up a travel blog for me" ended at a shell
 * prompt somebody else had to reach.
 *
 * A journal is still just `content/<username>/config.json` and a `trips/`
 * folder. This writes that, and refuses in every case where writing it would
 * be a mistake — the username is a directory name and a URL segment, which is
 * to say a security boundary, so it is checked the same way `lib/users.ts`
 * checks it when reading.
 */

export type NewJournal = {
  username: string;
  title: string;
  tagline?: string;
  /** The address that owns it: the only one that can get a token to write. */
  ownerEmail: string;
  ownerName?: string;
  startLocation?: string;
  defaultLocale?: string;
  locales?: string[];
  baseCurrency?: string;
  displayCurrencies?: string[];
  units?: "metric" | "imperial";
};

export type CreateJournalResult =
  | { ok: true; username: string }
  | { ok: false; error: string; message: string };

/** How many journals one address may own. Not a licensing rule — a brake on
 * the obvious abuse of an endpoint anybody with an email can reach. */
export const MAX_JOURNALS_PER_EMAIL = 3;

/** Journals this address already owns, by reading what is on disk. */
export function journalsOwnedBy(email: string): string[] {
  const address = email.trim().toLowerCase();
  if (!address) return [];
  const owned: string[] = [];
  for (const username of getUsernames()) {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(contentRoot(), username, "config.json"), "utf8"),
      ) as { ownerEmail?: unknown };
      if (typeof raw.ownerEmail === "string" && raw.ownerEmail.trim().toLowerCase() === address) {
        owned.push(username);
      }
    } catch {
      // A journal whose config cannot be read is somebody else's problem —
      // `loadUserConfig` reports it. It is certainly not owned by this address.
    }
  }
  return owned;
}

export function createJournal(input: NewJournal): CreateJournalResult {
  const username = input.username.trim().toLowerCase();

  if (!isValidUsername(username)) {
    return {
      ok: false,
      error: "invalid_username",
      message:
        "A username is 2–31 characters of lowercase letters, digits and dashes, " +
        "starting with a letter or digit. It becomes the address of the journal.",
    };
  }
  if (isReservedUsername(username)) {
    return {
      ok: false,
      error: "reserved_username",
      message: `"${username}" is reserved by this server — it would shadow one of its own routes.`,
    };
  }

  const dir = path.join(contentRoot(), username);
  // `existsSync` rather than a check against getUsernames(): a directory with
  // no readable config is still a directory, and overwriting it would destroy
  // whatever is in it.
  if (fs.existsSync(dir)) {
    return {
      ok: false,
      error: "username_taken",
      message: `"${username}" already exists on this server.`,
    };
  }

  const title = input.title.trim();
  if (!title) {
    return { ok: false, error: "invalid_title", message: "A journal needs a title." };
  }

  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const owned = journalsOwnedBy(ownerEmail);
  if (owned.length >= MAX_JOURNALS_PER_EMAIL) {
    return {
      ok: false,
      error: "too_many_journals",
      message:
        `This address already owns ${owned.length} journals (${owned.join(", ")}), ` +
        `which is the limit on this server.`,
    };
  }

  const config = {
    title,
    // Omitted rather than written empty when there is none. `readString` in
    // lib/config.ts accepts a missing tagline and falls back, but rejects an
    // empty one — so `"tagline": ""` produces a journal that will not load,
    // which is a strange way to punish somebody for not having a subtitle.
    // Inventing one instead would be worse: it is the owner's line, not ours.
    ...(input.tagline?.trim() ? { tagline: input.tagline.trim() } : {}),
    ownerEmail,
    travellers: input.ownerName?.trim()
      ? [{ name: input.ownerName.trim(), nickname: input.ownerName.trim().split(/\s+/)[0] }]
      : [],
    ...(input.startLocation?.trim() ? { startLocation: input.startLocation.trim() } : {}),
    defaultLocale: input.defaultLocale ?? "en",
    locales: input.locales?.length ? input.locales : [input.defaultLocale ?? "en"],
    baseCurrency: input.baseCurrency ?? "CHF",
    displayCurrencies: input.displayCurrencies?.length
      ? input.displayCurrencies
      : [input.baseCurrency ?? "CHF"],
    units: input.units ?? "metric",
    features: {
      reactions: { enabled: true },
      costs: { enabled: true },
      // On, or the owner could never get a token to write to what they just
      // made — which would make this endpoint produce a journal nobody can use.
      auth: { enabled: true },
    },
  };

  // The trips folder is created with it. A journal whose `trips/` does not
  // exist reads as broken rather than as empty.
  fs.mkdirSync(path.join(dir, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
    "utf8",
  );

  // Both caches are keyed by path and would otherwise answer "no such user"
  // for the rest of this process's life.
  clearUserCache();
  clearConfigCache();

  return { ok: true, username };
}
