import "server-only";
import fs from "node:fs";
import path from "node:path";
import { hasSwitchedOff, isEnabled, resolveCapabilities } from "./capabilities";
import { clearConfigCache, FEATURE_NAMES, type FeatureName, type JournalVisibility } from "./config";
import { contentRoot } from "./contentRoot";
import { issueStandingLink, signInUrl } from "./auth";
import type { TranslationKey } from "./i18n";
import { translateIn } from "./locales";
import { sendMail } from "./mail";
import { renderMail } from "./mail/template";
import { serverSite } from "./site";
import { journalTombstone } from "./tombstones";
import { clearUserCache, getUser, getUsernames, isReservedUsername, isValidUsername } from "./users";

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
  /**
   * `next` is the call to make instead, where there is one. The successful
   * replies on this API all carry one and it is the single thing agents said
   * was most useful about it; a refusal that leaves the caller with no move is
   * where that stops being true.
   */
  | { ok: false; error: string; message: string; next?: string };

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
  // Answered before the general reserved check, because the reason is
  // different and so is what the caller should do about it. "It would shadow a
  // route" invites trying a near-miss; "somebody deleted a journal that lived
  // here" says the name is not coming back on this server.
  const stone = journalTombstone(username);
  if (stone) {
    return {
      ok: false,
      error: "deleted_username",
      message:
        `"${username}" belonged to a journal that was deleted on ` +
        `${stone.deletedAt.slice(0, 10)}, and this server does not hand a name back. ` +
        `Every old link and bookmark still points at it, and they must not resolve to ` +
        `somebody else's journal. Pick another name.`,
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
      /**
       * The route onward, for the case that actually happens.
       *
       * "Set up my travel journal" from somebody who set one up last month is
       * the same sentence, and an agent following the guide's signup path
       * lands here holding a signup token — a credential that by design can
       * only create journals, so there is nothing it can do next. It used to
       * be told the name was taken and nothing else.
       *
       * Phrased as a condition, never as a fact. This server does not know
       * whether the caller owns the name and must not check: a refusal that
       * differed for the owner would turn journal creation into a way of
       * asking whether an address owns a journal, which is exactly what the
       * uniform 202 on /api/auth/request exists to prevent.
       */
      next:
        `If "${username}" is theirs, they do not need a new journal — they need a write ` +
        `token for this one. POST /api/auth/request with ` +
        `{"user": "${username}", "email": "<their address>", "kind": "agent"}, then exchange ` +
        `the code at /api/auth/verify.`,
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
      // Safe to be specific here in a way the taken-name refusal is not: the
      // caller has already proved they can read this address, and the reply
      // names the journals it owns anyway.
      next:
        `To write to one of them instead, POST /api/auth/request with ` +
        `{"user": "${owned[0]}", "email": "<their address>", "kind": "agent"}.`,
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
      // On, for the same reason one line up, and B153 is the evidence: with it
      // off, an agent that had just built somebody their journal got
      // `404 contacts_disabled` on the very next call, and there was no
      // endpoint, tool or page anywhere that could change it — the only way in
      // was to hand-edit this file over SSH. B39 removed trip passwords, so an
      // invite link is now the *only* way to let anybody into a journal, and a
      // journal that cannot be shared is not a finished journal.
      //
      // This is not the gate. The server's own `features.contacts` is, and it
      // stays off until an operator sets CONTACTS_ENCRYPTION_KEY and a
      // DATABASE_URL — `resolveOne` in lib/capabilities.ts treats the server as
      // a ceiling and this as the opt-in underneath it. Nothing here is
      // advertised to a stranger either: B37 removed the open request form, and
      // the invite controls render inside `{viewer.owner && …}` on /<user>/me.
      contacts: { enabled: true },
      // `mail` is deliberately *not* written here, even though B60 made a
      // journal's own switch govern the letters it sends. Absent means "no
      // opinion" and inherits the server's answer (see `USER_DEFAULT_FEATURES`
      // in lib/config.ts), so a line saying `true` would change nothing — and
      // the rule this file already follows for `visibility` is that the owner
      // reading their own config should find the lines that are doing
      // something. Writing it would also make journals created after this
      // commit behave differently from every journal already on disk, which is
      // the difference that has to not exist.
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
  // The journal's own switch as well as the server's — this is a letter the
  // journal sends, not a code somebody asked for. Asked as the same two
  // questions `sendMail` asks, so there is one way to put it: can the server
  // send, and has this journal said no. A journal that has never mentioned
  // mail has not said no, and neither has one whose config cannot be read.
  // See `hasSwitchedOff` in lib/capabilities.ts, and B60.
  if (!isEnabled("mail")) return false;
  if (hasSwitchedOff("mail", input.username)) return false;

  const site = serverSite();
  const url = `${site.url}/${input.username}`;
  const locale = input.locale ?? "en";
  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translateIn(locale, key, vars);

  /**
   * The button signs them in; the plain address is in the text underneath.
   *
   * Without a session this mail invited its reader to look at a page that
   * shows them none of the work that prompted it: an agent has just written
   * drafts, into a trip that is private by default, and both are invisible to
   * an anonymous visitor. "You can see what is waiting at any time" followed
   * by a link that cannot is the wrong first impression to give somebody about
   * their own journal.
   *
   * Best effort, like the mail itself. `auth` is an optional capability and a
   * journal on an instance without it still gets a welcome mail — with the
   * address and no button, which is what it can honestly offer.
   */
  let signIn: string | null = null;
  if (isEnabled("auth", input.username)) {
    try {
      signIn = signInUrl(site.url, input.username, await issueStandingLink(input.username, input.email));
    } catch (err) {
      console.error(`[journals] no sign-in link for ${input.username}:`, err);
    }
  }

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
            { kind: "button", text: t("welcome.open"), href: signIn ?? url },
            // What the button does, and the address on its own. The button
            // signs whoever taps it in, so somebody forwarding this mail as
            // "here is my journal" needs to know that is not all they are
            // sending. And a link that has been used is spent — this mail is
            // the only one carrying the address, so the address has to be in
            // it as text too.
            { kind: "paragraph", text: t(signIn ? "welcome.linkNote" : "welcome.addressNote", { url }) },
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

/**
 * Change which capabilities a journal has asked for — B182.
 *
 * ## Why this exists
 *
 * A journal's `features` block was written once, by whatever `createJournal`
 * happened to say on the day it ran, and then frozen: nothing in `app/` or
 * `lib/` wrote it, so the only way to change one was a shell on the server and
 * a text editor. That left every journal made before B153 with contacts off
 * and no way to turn them on — which, since B39 removed trip passwords, means a
 * journal that cannot let anybody in and cannot be repaired from the outside.
 * It is not only contacts: `mail`, `signup`, `push`, `postcards` and
 * `photobook` are all per-journal opt-ins under a server ceiling and none of
 * them could be opted into after the fact.
 *
 * ## What it will not do
 *
 * **Only `features`.** Not the title, not the locales, not the currencies —
 * those have the same problem and are a wider surface with different questions
 * in it (see B220). And explicitly never **`owner.email`**: that address is the
 * credential which decides who can obtain a token for this journal (decision
 * 24), so a call that could rewrite it would be a call that could hand the
 * journal to somebody else. An agent holding a token is *inside* the boundary
 * that address defines, and nothing inside a boundary may move it. Changing it
 * is an operator's job, at the file.
 *
 * **It cannot widen past the server.** `resolveOne` in lib/capabilities.ts
 * already treats `content/config.json` as a ceiling, so a journal that wrote
 * `"contacts": { "enabled": true }` under a server with contacts off would stay
 * off regardless — the write would simply do nothing. That silence is the
 * problem, so this refuses instead, with the server's own reason for the
 * capability being unavailable. The check is not a second implementation of the
 * rule: it asks `isEnabled(name)` with no username, which *is* the ceiling.
 *
 * Switching something **off** is always allowed, whatever the server says. A
 * journal narrowing itself needs no permission, and `features.mail: false` in
 * particular is a mute button somebody must always be able to press (B60).
 *
 * The file is edited rather than rewritten: the raw JSON is parsed, the one
 * `enabled` flag inside each named feature is set, and everything else —
 * `transport`, `provider`, keys this version has never heard of — is left
 * exactly as it was. And it is read back through `getUser` before the call
 * reports success, restoring the previous bytes if the result does not parse:
 * a config file that will not load takes the whole journal off the site, which
 * is not something to discover later. B204 is the same lesson, one file over.
 */
export type SetFeaturesResult =
  | {
      ok: true;
      username: string;
      /** Every capability, as this journal now asks for it. */
      features: Record<FeatureName, boolean>;
      /** The ones this call actually changed, which may be none. */
      changed: FeatureName[];
    }
  | { ok: false; error: string; message: string };

export function setJournalFeatures(
  username: string,
  changes: Record<string, unknown>,
): SetFeaturesResult {
  const user = getUser(username);
  if (!user) {
    return {
      ok: false,
      error: "no_such_journal",
      message: `There is no journal "${username}" on this server, or its config.json cannot be read.`,
    };
  }

  const wanted: [FeatureName, boolean][] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (!(FEATURE_NAMES as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: "unknown_feature",
        message: `"${key}" is not a capability on this server. Known: ${FEATURE_NAMES.join(", ")}.`,
      };
    }
    if (typeof value !== "boolean") {
      return {
        ok: false,
        error: "invalid_feature",
        message: `features.${key} must be true or false, not ${JSON.stringify(value)}.`,
      };
    }
    wanted.push([key as FeatureName, value]);
  }
  if (wanted.length === 0) {
    return {
      ok: false,
      error: "nothing_to_change",
      message:
        `Name at least one capability to switch on or off: ` +
        `{"features": {"contacts": true}}. Known: ${FEATURE_NAMES.join(", ")}.`,
    };
  }

  // The ceiling, asked of the server and not re-derived here. Only asked when
  // switching something *on*: narrowing needs no permission.
  const server = resolveCapabilities();
  for (const [name, enabled] of wanted) {
    if (!enabled) continue;
    const state = server[name];
    if (!state.enabled) {
      return {
        ok: false,
        error: "capability_unavailable",
        message:
          `This server cannot offer "${name}", so this journal cannot switch it on — ` +
          `${state.reason}. That is an operator's decision, in content/config.json and the ` +
          `environment; /api/health says what is missing. Nothing was changed.`,
      };
    }
  }

  const file = path.join(contentRoot(), username, "config.json");
  let previous: string;
  let raw: Record<string, unknown>;
  try {
    previous = fs.readFileSync(file, "utf8");
    const parsed: unknown = JSON.parse(previous);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    raw = parsed as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      error: "unreadable_config",
      message:
        `content/${username}/config.json could not be read as JSON, so nothing was changed. ` +
        `Fix the file first — this call edits it in place and will not overwrite what it ` +
        `cannot parse.`,
    };
  }

  const existing =
    typeof raw.features === "object" && raw.features !== null && !Array.isArray(raw.features)
      ? { ...(raw.features as Record<string, unknown>) }
      : {};

  const changed: FeatureName[] = [];
  for (const [name, enabled] of wanted) {
    if (user.features[name].enabled === enabled) continue;
    const entry =
      typeof existing[name] === "object" && existing[name] !== null && !Array.isArray(existing[name])
        ? { ...(existing[name] as Record<string, unknown>) }
        : {};
    // Only `enabled`. A transport or a provider chosen by hand survives this.
    existing[name] = { ...entry, enabled };
    changed.push(name);
  }

  if (changed.length > 0) {
    fs.writeFileSync(file, JSON.stringify({ ...raw, features: existing }, null, 2) + "\n", "utf8");
    clearUserCache();
    clearConfigCache();

    const after = getUser(username);
    if (!after) {
      // Put it back. A journal whose config does not parse is invisible at
      // every reading path, and this call is not the thing that gets to do
      // that to somebody.
      fs.writeFileSync(file, previous, "utf8");
      clearUserCache();
      clearConfigCache();
      return {
        ok: false,
        error: "write_failed",
        message:
          `The change was written and did not read back, so it has been undone and ` +
          `content/${username}/config.json is exactly as it was.`,
      };
    }
  }

  const now = getUser(username) ?? user;
  const features = {} as Record<FeatureName, boolean>;
  for (const name of FEATURE_NAMES) features[name] = now.features[name].enabled;
  return { ok: true, username, features, changed };
}
