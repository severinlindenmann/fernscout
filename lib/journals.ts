import "server-only";
import fs from "node:fs";
import path from "node:path";
import { isEnabled } from "./capabilities";
import { clearConfigCache, type JournalVisibility } from "./config";
import { contentRoot } from "./contentRoot";
import type { TranslationKey } from "./i18n";
import { translateIn } from "./locales";
import { sendMail } from "./mail";
import { renderMail } from "./mail/template";
import { serverSite } from "./site";
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
  ownerName: string;
  /**
   * What the site calls this person, in its own voice. Required, and never
   * guessed from `ownerName` — a first-word split mangles any name whose
   * given name is not first, which is exactly the shortcut W37 removed from
   * `lib/config.ts`'s `Owner`.
   */
  ownerNickname: string;
  /**
   * Whether the journal is advertised — see `JournalVisibility` in
   * lib/config.ts. Anything unrecognised, including nothing at all, is
   * `public`: that is what every journal made before the field existed is, and
   * quietly unlisting somebody who did not ask to be unlisted is its own kind
   * of surprise. An agent is told to ask; asking is the mechanism.
   */
  visibility?: JournalVisibility;
  startLocation?: string;
  defaultLocale?: string;
  locales?: string[];
  baseCurrency?: string;
  displayCurrencies?: string[];
  units?: "metric" | "imperial";
};

export type CreateJournalResult =
  | { ok: true; username: string; visibility: JournalVisibility }
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
      ) as { owner?: { email?: unknown } };
      if (
        typeof raw.owner?.email === "string" &&
        raw.owner.email.trim().toLowerCase() === address
      ) {
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

  const ownerName = input.ownerName.trim();
  if (!ownerName) {
    return { ok: false, error: "invalid_owner", message: "A journal needs the owner's name." };
  }
  const ownerNickname = input.ownerNickname.trim();
  if (!ownerNickname) {
    return {
      ok: false,
      error: "invalid_owner",
      message:
        "A journal needs the owner's nickname — what the site calls them. It is not guessed " +
        "from their name.",
    };
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
    // `nickname` is required rather than derived from `name`: a first-word
    // split mangles any name whose given name is not first, so there is no
    // safe guess to fall back to — the caller must ask.
    owner: { name: ownerName, nickname: ownerNickname, email: ownerEmail },
    // Written only when it is `private`. A file that says `"visibility":
    // "public"` on every journal makes the field look like something you set,
    // when the interesting half is the other one — and the owner reading their
    // own config should find the line that is doing something.
    ...(input.visibility === "private" ? { visibility: "private" } : {}),
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

  return { ok: true, username, visibility: input.visibility === "private" ? "private" : "public" };
}

/**
 * Tell the owner their journal exists.
 *
 * The one mail this flow sends that is not a code. It carries the address of
 * the journal, because the person who owns it should not have to trust an
 * agent to have copied a URL correctly; and it carries the draft rule, because
 * the first thing that will happen to this journal is an agent writing days
 * into it that nobody has read yet.
 *
 * Returns whether it went. Never throws: the caller has already written the
 * journal to disk, and there is no version of "the SMTP server was busy" that
 * should undo that.
 */
export async function sendWelcome(input: {
  username: string;
  title: string;
  email: string;
  nickname: string;
  visibility: JournalVisibility;
  /**
   * The journal's own language. Anything this instance does not maintain a
   * dictionary for falls back to English inside `dictionaryFor`, so a journal
   * that speaks a fourth language still gets a readable letter rather than a
   * page of missing keys.
   */
  locale?: string;
}): Promise<boolean> {
  if (!isEnabled("mail")) return false;

  const site = serverSite();
  const url = `${site.url}/${input.username}`;
  const locale = input.locale ?? "en";
  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translateIn(locale, key, vars);

  try {
    await sendMail(
      renderMail(
        input.email,
        t("welcome.subject", { title: input.title }),
        {
          preheader: t("welcome.intro", {
            nickname: input.nickname,
            title: input.title,
            site: site.name,
          }),
          title: t("welcome.title"),
          blocks: [
            {
              kind: "paragraph",
              text: t("welcome.intro", {
                nickname: input.nickname,
                title: input.title,
                site: site.name,
              }),
            },
            { kind: "button", text: t("welcome.open"), href: url },
            {
              kind: "paragraph",
              text: t(input.visibility === "private" ? "welcome.private" : "welcome.public"),
            },
            { kind: "heading", text: t("welcome.draftsHeading") },
            { kind: "paragraph", text: t("welcome.draftsRule") },
            { kind: "paragraph", text: t("welcome.drafts") },
            { kind: "heading", text: t("welcome.tokenHeading") },
            {
              kind: "paragraph",
              text: t("welcome.token", {
                guide: `${site.url}/agent.md`,
                email: input.email,
              }),
            },
          ],
          // The footer follows the body. An English "Sent by …" under a
          // Hungarian letter is the seam that sends somebody to the spam
          // button — the digest already learned this.
          footer: t("welcome.footer", { site: site.name }),
        },
        input.username,
      ),
    );
    return true;
  } catch (err) {
    console.error(`[journals] welcome mail for ${input.username} failed:`, err);
    return false;
  }
}
