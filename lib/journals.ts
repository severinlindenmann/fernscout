import "server-only";
import fs from "node:fs";
import path from "node:path";
import { hasSwitchedOff, isEnabled, resolveCapabilities } from "./capabilities";
import {
  clearConfigCache,
  FEATURE_NAMES,
  normalizeJournalVisibility,
  OPERATOR_ONLY_FEATURES,
  type FeatureName,
  type JournalVisibility,
  type UserConfig,
} from "./config";
import { contentRoot } from "./contentRoot";
import { normalizeCurrency, type RateTable } from "./currency";
import { release, reserve } from "./registry";
import { toE164 } from "./whatsapp/phone";
import { issueStandingLink, signInUrl } from "./auth";
import { LOCALE_LIST } from "./api/agentCopy";
import { MAINTAINED_LOCALES, type TranslationKey } from "./i18n";
import { LOCALE_TAG_RE, translateIn } from "./locales";
import { sendMail } from "./mail";
import { renderMail } from "./mail/template";
import { serverSite } from "./site";
import { clearTombstone, journalTombstone } from "./tombstones";
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
   * lib/config.ts. Widened to accept `"private"` too, the word this field
   * used before B306, normalised the same way it is everywhere else
   * (`normalizeJournalVisibility`) so this function behaves identically
   * whichever a caller sends and never writes the old word back out.
   * Anything unrecognised, including nothing at all, is `public`: that is
   * what every journal made before the field existed is, and quietly
   * unlisting somebody who did not ask to be unlisted is its own kind of
   * surprise. An agent is told to ask; asking is the mechanism.
   *
   * That default is for a direct caller of this function — the caller that
   * reaches it in production, `POST /api/v1/journals`, refuses a request
   * that omits it rather than ever passing `undefined` down to here (B263).
   * Silence reaching this default at all would mean that caller stopped
   * asking.
   */
  visibility?: JournalVisibility | "private";
  startLocation?: string;
  /**
   * The owner's own language. Falls back to `"en"` here for the same reason
   * as `visibility` above — a direct caller's convenience — and for the same
   * reason both production doors require it rather than ever reaching this
   * fallback (B263): it sets the language of the welcome mail, the first
   * thing this software says to somebody, and defaulting it silently is how a
   * German journal used to greet its owner in English.
   */
  defaultLocale?: string;
  /**
   * Which languages a reader may switch the journal into. Falls back to
   * `[defaultLocale]` here for the same reason as above — a direct caller's
   * convenience — and for the same reason both production doors require it
   * rather than ever reaching this fallback (B277): it is what the language
   * switcher renders from, so a journal created without it has no switcher
   * at all, and the owner who asked for three languages found out they had
   * one.
   */
  locales?: string[];
  baseCurrency?: string;
  displayCurrencies?: string[];
  units?: "metric" | "imperial";
  /**
   * A number proven before this call — B1064/B1065. E.164 digits, already
   * normalised by the caller (`toE164`); this function does not re-validate
   * the shape, only that it is not already somebody else's.
   *
   * Absent for the two exemptions B1064 names (the operator address, and a
   * `test-` journal) and for every caller that predates this field — a
   * missing `ownerTel` simply reserves no number, exactly like an exempt
   * journal.
   */
  ownerTel?: string;
  /** When the number above was proven. Required together with `ownerTel` —
   * see the check below — because an unproven number is not this registry's
   * business (`lib/registry.ts:reconcile`). */
  ownerTelProvenAt?: string;
  ownerTelProvenMethod?: "sms" | "operator" | "whatsapp-inbound";
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
 * the obvious abuse of an endpoint anybody with an email can reach.
 *
 * **One, since B840.** It was three, which promised something no part of this
 * software supports: there is no way to switch between journals you own, no
 * way to buy a second, and nothing anywhere that names the number — so three
 * only ever meant "two abandoned experiments are possible". The pricing table
 * says one journal, and this is what makes that true rather than a claim.
 *
 * B92's other half is now load bearing rather than optional: at a cap of one,
 * somebody who deletes their journal has a free slot and cannot use it for the
 * only name they want, because the tombstone reserves it against everybody
 * including them. Until that lands, deleting is one way. */
export const MAX_JOURNALS_PER_EMAIL = 1;

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
  // Normalised once, here, so every later use of `input.visibility` in this
  // function — the file written, and the value handed back — agrees, and so
  // a caller that still sends the old word gets exactly what one sending
  // `"guest"` gets. See `normalizeJournalVisibility`.
  const visibility = normalizeJournalVisibility(input.visibility) ?? "public";

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
  //
  // One exception — B92: the person who deleted it may take the name back.
  // `stone.requestedBy` is the owner's address at the moment of deletion
  // (lib/tombstones.ts). Three things all have to hold for that to be true
  // rather than a stranger fishing for a reused name: the tombstone is for a
  // *journal* (never a trip's — `journalTombstone` only ever reads that
  // shape, but it is checked anyway rather than trusted), `ownerEmail`
  // matches `requestedBy`, and this address owns nothing today — the last is
  // what stops a tombstone from ever being a second slot rather than the
  // same one back, since without it an address that still held a live
  // journal could delete a throwaway second one and use its tombstone to
  // dodge the cap. `owned` is computed once, ahead of everything else, and
  // reused by the ordinary cap check further down so the two can never
  // disagree about what this address holds right now.
  //
  // The two refusals below read differently on purpose, and that is the
  // whole of what is allowed to differ: a stranger — this address never
  // asked for this deletion — gets the sentence this refusal has always
  // given, unchanged, so nothing here tells them the name was ever anybody's.
  // The owner who asked for it gets told that, because it is true of them
  // and only them, and a request that already proved it can read this
  // address is not one this refusal owes secrecy to.
  const stone = journalTombstone(username);
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const owned = journalsOwnedBy(ownerEmail);
  let reclaimingTombstone = false;
  if (stone) {
    const isRequester = stone.kind === "journal" && stone.requestedBy.trim().toLowerCase() === ownerEmail;
    if (!isRequester) {
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
    if (owned.length > 0) {
      return {
        ok: false,
        error: "deleted_username",
        message:
          `"${username}" is the journal this address deleted, and it can be reclaimed — but ` +
          `not while this address still owns "${owned[0]}", which is the limit on this server. ` +
          `Delete that one first, or keep it and pick a different name for a new journal.`,
      };
    }
    reclaimingTombstone = true;
  }

  // On a reclaim only the *tombstone* reason is set aside — the caller above
  // has already been vetted as the owner taking their own name back, and
  // asking again here would refuse the one case this change exists for. The
  // other reasons still hold against them: a name in ALWAYS_RESERVED would
  // shadow a route, a name the operator has since added to `users.reserved`
  // is the operator's call and not undone by having once owned it, and a
  // server config that will not load still fails closed. Skipping the whole
  // check would have quietly handed all three away.
  if (isReservedUsername(username, { ignoreTombstone: reclaimingTombstone })) {
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

  // `ownerEmail` and `owned` are both computed above, where the tombstone
  // check needed them first — reused here rather than recomputed, so the two
  // checks can never disagree about whose address this is or what it holds.
  // A reclaim (`reclaimingTombstone`) always reaches this with `owned.length
  // === 0`, since the tombstone check above already refused otherwise, so
  // reclaiming a name is never itself a way past this cap.
  if (owned.length >= MAX_JOURNALS_PER_EMAIL) {
    return {
      ok: false,
      error: "too_many_journals",
      // Reads right at a cap of one, which is what it is — "already owns 1
      // journals (alex)" was what the plural-only sentence produced. B840.
      message:
        owned.length === 1
          ? `This address already owns "${owned[0]}", and one journal per address is the ` +
            `limit on this server.`
          : `This address already owns ${owned.length} journals (${owned.join(", ")}), ` +
            `which is the limit on this server.`,
      // Safe to be specific here in a way the taken-name refusal is not: the
      // caller has already proved they can read this address, and the reply
      // names the journals it owns anyway.
      next:
        `To write to one of them instead, POST /api/auth/request with ` +
        `{"user": "${owned[0]}", "email": "<their address>", "kind": "agent"}.`,
    };
  }

  // B1064's lock, on top of the disk scan above: an atomic exclusive file
  // create rather than a race two concurrent creates could both win.
  // Reserved *before* the config is written, so a caller that loses this
  // race leaves nothing on disk — see `lib/registry.ts:reserve`.
  const reserved = reserve(username, ownerEmail, input.ownerTel ?? null);
  if (!reserved.ok) {
    return reserved.conflict === "email"
      ? {
          ok: false,
          error: "too_many_journals",
          message: `This address already owns a journal, and one journal per address is the limit on this server.`,
        }
      : {
          ok: false,
          error: "tel_taken",
          message: `That telephone number already belongs to another journal on this server.`,
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
    owner: {
      name: ownerName,
      nickname: ownerNickname,
      email: ownerEmail,
      ...(input.ownerTel ? { tel: input.ownerTel } : {}),
      ...(input.ownerTel && input.ownerTelProvenAt ? { telProvenAt: input.ownerTelProvenAt } : {}),
      ...(input.ownerTel && input.ownerTelProvenMethod ? { telProvenMethod: input.ownerTelProvenMethod } : {}),
    },
    // Written only when it is `guest`, and never as the old word `private`
    // even when that is what the caller sent — see `normalizeJournalVisibility`.
    // A file that says `"visibility": "public"` on every journal makes the
    // field look like something you set, when the interesting half is the
    // other one — and the owner reading their own config should find the
    // line that is doing something.
    ...(visibility === "guest" ? { visibility: "guest" } : {}),
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
      // was to hand-edit this file over SSH. B39 removed trip passwords, so
      // approving a contact — from an invite the owner sent, or since B601
      // from a reader who asked at a locked trip — is now the only way anybody
      // is let into a journal, and a journal that cannot be shared is not a
      // finished journal.
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
  try {
    fs.mkdirSync(path.join(dir, "trips"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify(config, null, 2) + "\n",
      "utf8",
    );
  } catch (err) {
    // The reservation above holds the address (and number) hostage against a
    // journal that was never actually written — undo it, rather than leave
    // that address locked out of ever signing up again by a disk fault.
    release(username, ownerEmail, input.ownerTel ?? null);
    throw err;
  }

  // Both caches are keyed by path and would otherwise answer "no such user"
  // for the rest of this process's life.
  clearUserCache();
  clearConfigCache();

  // Consumed only now that the write above actually succeeded — B92. The
  // reservation has done its job: the name is a live journal again, so
  // `journalTombstone`/`isDeletedUsername` must stop matching it, and with
  // them the `410 Gone` `proxy.ts` serves off a tombstone still standing.
  if (reclaimingTombstone) clearTombstone(username);

  return { ok: true, username, visibility };
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
   * drafts, which stay invisible to an anonymous visitor whatever the trip's
   * own visibility is. "You can see what is waiting at any time" followed
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
              // The translation keys keep their old names — they are
              // internal identifiers, not the copy a reader sees — but the
              // copy itself has been reworded for `guest`. See
              // site/locales/*.json.
              text: t(input.visibility === "guest" ? "welcome.private" : "welcome.public"),
            },
            { kind: "heading", text: t("welcome.draftsHeading") },
            { kind: "paragraph", text: t("welcome.draftsRule") },
            { kind: "paragraph", text: t("welcome.drafts") },
            { kind: "heading", text: t("welcome.tokenHeading") },
            {
              kind: "paragraph",
              text: t("welcome.token", {
                guide: `${site.url}/documentation.txt`,
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
 * Edit `content/<user>/config.json` in place, and put it back if it breaks.
 *
 * The one shape both writers of that file share, extracted when B220 added the
 * second one. Three properties, and each is load-bearing:
 *
 * - **Edited, not regenerated.** The callback is handed the parsed JSON and
 *   returns it changed, so keys this version of the code has never heard of —
 *   a transport, a provider, something an operator added — survive a write.
 * - **Nothing is written for a config that will not parse.** A caller cannot
 *   silently repair a broken file by writing over it.
 * - **Read back through `getUser`, and restored if it does not load.** A
 *   config that fails `parseUser` takes the whole journal off the site, at
 *   every reading path at once. That is not something a call like this gets to
 *   do to somebody, and discovering it later is worse than the refusal. B204
 *   is the same lesson one file over, where a trip.md that did not read back
 *   consumed its id for good.
 *
 * The callback returns `null` for "nothing to write", which is how a change
 * that asks for exactly what is already there costs no write at all.
 */
type ConfigEdit = (raw: Record<string, unknown>) => Record<string, unknown> | null;

function editUserConfigFile(
  username: string,
  edit: ConfigEdit,
): { ok: true; wrote: boolean } | { ok: false; error: string; message: string } {
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

  const next = edit(raw);
  if (!next) return { ok: true, wrote: false };

  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  clearUserCache();
  clearConfigCache();

  if (!getUser(username)) {
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
  return { ok: true, wrote: true };
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
 * already treats `site/config.json` as a ceiling, so a journal that wrote
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

/**
 * A journal's `features` block exactly as any reader should show it: the
 * per-journal flag for an opt-in, the server-resolved answer for the two
 * capabilities in `OPERATOR_ONLY_FEATURES` that are never a journal's own to
 * set. The one place this map is built, so the GET and the PATCH on
 * `/api/v1/<user>/config` cannot answer differently about the same journal in
 * the same second — B408 fixed `view()` alone and `setJournalFeatures` below
 * kept reading the raw per-journal flag for both, which is exactly how B408
 * came back on the PATCH response (B607).
 */
export function journalFeatures(user: UserConfig): Record<FeatureName, boolean> {
  const serverOnly = resolveCapabilities();
  const features = {} as Record<FeatureName, boolean>;
  for (const name of FEATURE_NAMES) {
    features[name] = (OPERATOR_ONLY_FEATURES as readonly string[]).includes(name)
      ? serverOnly[name].enabled
      : user.features[name].enabled;
  }
  return features;
}

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

  // `OPERATOR_ONLY_FEATURES` have no journal-level answer at all — writing the
  // key would leave a flag in the file that nothing reads, and answering `ok`
  // to "turn my photobook off" while the button stays is worse than refusing.
  // The operator's `site/config.json` is the only place. B611; the two
  // printers joined `logging` and `credits` there, and this refusal is what
  // stops the response promising a change that did not happen.
  const refused = wanted.find(([name]) =>
    (OPERATOR_ONLY_FEATURES as readonly string[]).includes(name),
  );
  if (refused) {
    return {
      ok: false,
      error: "capability_not_yours",
      message:
        `"${refused[0]}" is decided by this server for every journal on it, so it cannot be ` +
        `switched from a journal's own config. Ask the operator to change ` +
        `features.${refused[0]} in site/config.json; /api/health reports what it answers. ` +
        `Nothing was changed.`,
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
          `${state.reason}. That is an operator's decision, in site/config.json and the ` +
          `environment; /api/health says what is missing. Nothing was changed.`,
      };
    }
  }

  const changed: FeatureName[] = [];
  const written = editUserConfigFile(username, (raw) => {
    const existing =
      typeof raw.features === "object" && raw.features !== null && !Array.isArray(raw.features)
        ? { ...(raw.features as Record<string, unknown>) }
        : {};
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
    return changed.length > 0 ? { ...raw, features: existing } : null;
  });
  if (!written.ok) return written;

  const now = getUser(username) ?? user;
  return { ok: true, username, features: journalFeatures(now), changed };
}

/**
 * The rest of a journal's `config.json` — B220.
 *
 * ## Why there is a second writer
 *
 * B182 gave the `features` block a door and deliberately stopped there. What
 * it left frozen was everything a journal *says about itself*: a title typoed
 * at signup, a tagline nobody can fix, a language the owner wants to add. The
 * person who owns the journal has never seen the folder (B28), so "edit
 * config.json" is advice with nowhere to go, and there is no settings page and
 * will not be one (decision 24).
 *
 * ## What it writes, and what it refuses
 *
 * B220 asked for a decision per field rather than for the file to be opened,
 * because these do not deserve the same care. `JOURNAL_PROFILE_FIELDS` is the
 * whole accepted list. Three fields are refused, each for its own reason, and
 * `JOURNAL_FIELD_REFUSALS` carries the sentence the caller is told:
 *
 * - **`owner.email`** — the address that decides who can obtain a token for
 *   this journal (decision 24). A token issued because of that address must
 *   not be able to move it: nothing inside a boundary may move the boundary.
 *   That refusal is B182's and is unchanged.
 * - **`baseCurrency`** — the field that reads like a display setting and is
 *   not. A cost written without a `currency:` **is** a cost in the base
 *   currency (`lib/entries.ts`, `lib/costs.ts`), so changing it does not
 *   reconvert anything: it silently changes what every bare amount ever
 *   written *meant*. A journal with one trip in it would have its money
 *   re-read rather than re-priced, with no error anywhere and no way back
 *   except editing every entry. It is safe exactly once, when the journal is
 *   created, and that is where it stays — `create_journal` takes it.
 * - **`media`** — the journal's narrowing of the server's upload limits. The
 *   server is already a ceiling over it (`narrowest()`, lib/mediaLimits.ts),
 *   so the only thing an agent could achieve is to make the journal accept
 *   *less* than the operator allows, and asking for more is not refused but
 *   silently narrowed away. Writing something inert is precisely what B182
 *   would not ship; the audience for this block is the operator, who has the
 *   file.
 *
 * ## Two calls, not one
 *
 * A body naming both `features` and one of these is refused by the route
 * rather than half-applied — see the note there. Each call edits the file
 * once, whole or not at all, which is the property `editUserConfigFile`
 * exists for.
 */
export const JOURNAL_PROFILE_FIELDS = [
  "title",
  "tagline",
  "visibility",
  "startLocation",
  "units",
  "locales",
  "defaultLocale",
  "displayCurrencies",
  "manualRates",
  "ownerTel",
] as const;

type JournalProfileField = (typeof JOURNAL_PROFILE_FIELDS)[number];

/** Why a field of `config.json` is not writable through an API. Keyed by the
 * top-level key a caller would send. */
export const JOURNAL_FIELD_REFUSALS: Record<string, string> = {
  owner:
    "The owner block is not writable as a whole. owner.email in particular is never writable " +
    "here — it is the address that decides who can get a token for this journal, so a token " +
    'cannot move it. The one part you can set is the telephone number, as "ownerTel": ' +
    '"+41 76 000 00 00" — it is what the owner\'s own WhatsApp copy of a day is sent to, and ' +
    "it costs no credits. Ask the person who runs the server for anything else in there.",
  baseCurrency:
    "baseCurrency is not writable after a journal exists. A cost written without a currency " +
    "IS a cost in the base currency, so changing it would not reconvert the money — it would " +
    "silently change what every amount already recorded means. It is set when the journal is " +
    "created and stays there.",
  media:
    "media is the operator's, not the journal's. The server's own limits are already a " +
    "ceiling over this block, so writing it could only make this journal accept less than the " +
    "server allows — and asking for more is narrowed away rather than refused, which is a " +
    "call that appears to do something and does not.",
};

/** The journal as this call sees it — what it just wrote, plus the one field
 * a caller has to know to send a usable `displayCurrencies`. */
export type JournalProfile = {
  title: string;
  tagline: string;
  visibility: JournalVisibility;
  startLocation: string;
  units: "metric" | "imperial";
  locales: string[];
  defaultLocale: string;
  displayCurrencies: string[];
  manualRates: RateTable;
  /**
   * `owner.tel`, flattened — B614.
   *
   * The empty string means there is none, the same way a cleared `tagline`
   * reads: the key is simply absent from the file, and `""` is what both a
   * read-back and a "clear this" write say about it.
   *
   * Flattened rather than a nested `owner: { tel }`, because the rest of that
   * block is not writable at all (see `JOURNAL_FIELD_REFUSALS`) and a nested
   * object here would advertise a door that is not there. It is also the one
   * writable field that is not a top-level key of `config.json`, which the
   * write step below handles by hand.
   */
  ownerTel: string;
  /** Read-only here, and included because `displayCurrencies` must contain
   * it — a caller that cannot see it can only guess. */
  baseCurrency: string;
};

export type SetProfileResult =
  | {
      ok: true;
      username: string;
      journal: JournalProfile;
      /** The fields this call actually changed, which may be none. */
      changed: JournalProfileField[];
    }
  | { ok: false; error: string; message: string };

/** A journal's writable description, as it stands. Exported so `GET` on the
 * same endpoint can show what a `PATCH` would be changing. */
export function journalProfile(user: UserConfig): JournalProfile {
  return {
    title: user.title,
    tagline: user.tagline,
    visibility: user.visibility,
    startLocation: user.startLocation,
    units: user.units,
    locales: user.locales,
    defaultLocale: user.defaultLocale,
    displayCurrencies: user.displayCurrencies,
    manualRates: user.manualRates,
    ownerTel: user.owner.tel ?? "",
    baseCurrency: user.baseCurrency,
  };
}

/**
 * One line of text, trimmed — or the sentence saying why it is not.
 *
 * Control characters rather than only newlines: this lands in a JSON string
 * that is rendered into a `<title>`, an OG tag and a mail subject, and a tab
 * or a stray escape in a journal's name is nobody's title.
 */
function oneLine(field: string, value: unknown): { text: string } | { problem: string } {
  if (typeof value !== "string") {
    return { problem: `${field} must be text.` };
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return {
      problem:
        `${field} must be a single line of plain text — it is rendered into the page title, ` +
        `the sharing card and the journal's mail, none of which have a second line.`,
    };
  }
  return { text: value.trim() };
}

export function setJournalProfile(
  username: string,
  changes: Record<string, unknown>,
): SetProfileResult {
  const user = getUser(username);
  if (!user) {
    return {
      ok: false,
      error: "no_such_journal",
      message: `There is no journal "${username}" on this server, or its config.json cannot be read.`,
    };
  }

  const keys = Object.keys(changes);
  if (keys.length === 0) {
    return {
      ok: false,
      error: "nothing_to_change",
      message:
        `Name at least one field to change: {"title": "…"}. Writable: ` +
        `${JOURNAL_PROFILE_FIELDS.join(", ")}.`,
    };
  }

  /** What to write, and what to remove. A field cleared to "" takes its key
   * out of the file rather than writing an empty string — `readString` in
   * lib/config.ts refuses an empty tagline, so `"tagline": ""` would produce a
   * journal that will not load. */
  const patch: Record<string, unknown> = {};
  const remove: string[] = [];
  const refuse = (error: string, message: string): SetProfileResult => ({
    ok: false,
    error,
    message,
  });

  for (const key of keys) {
    if (!(JOURNAL_PROFILE_FIELDS as readonly string[]).includes(key)) {
      const why = JOURNAL_FIELD_REFUSALS[key];
      return refuse(
        "unsupported_field",
        why ??
          `"${key}" is not a field this writes. Writable: ${JOURNAL_PROFILE_FIELDS.join(", ")}, ` +
            `and the features block through its own call.`,
      );
    }
    const value = changes[key];

    switch (key) {
      case "title":
      case "tagline":
      case "startLocation": {
        const read = oneLine(key, value);
        if ("problem" in read) return refuse(`invalid_${key}`, read.problem);
        if (!read.text) {
          if (key === "title") {
            return refuse("invalid_title", "A journal needs a title; it cannot be cleared.");
          }
          remove.push(key);
        } else {
          patch[key] = read.text;
        }
        break;
      }

      case "ownerTel": {
        const read = oneLine(key, value);
        if ("problem" in read) return refuse("invalid_ownerTel", read.problem);
        if (!read.text) {
          // Cleared, which is also how the owner turns their own WhatsApp
          // copy off again: no number, no message, and nothing else about it
          // to switch.
          remove.push(key);
          break;
        }
        // Normalised here rather than on the way out of the file, so what is
        // stored is what the send path uses and a number that cannot work is
        // refused while somebody is still looking at the answer.
        //
        // No default country code, deliberately — the same rule
        // `parseOwner` applies, and for the same reason: the operator's
        // `defaultCountryCode` is an env var, and a number that depends on it
        // would stop working when the operator changed it.
        const tel = toE164(read.text);
        if (!tel) {
          return refuse(
            "invalid_ownerTel",
            `"${read.text}" is not a telephone number this can use. Include the country code — ` +
              `+41 76 000 00 00, 0041 76 000 00 00 or 41760000000. A national number like ` +
              `076 000 00 00 is refused: it means a different telephone in every country, and ` +
              `this server is not standing in any of them.`,
          );
        }
        patch[key] = tel;
        break;
      }

      case "visibility": {
        // `"private"` — the word this field used before B306 — is still
        // accepted here and normalised to `guest`, the same as everywhere
        // else this level's visibility is read or written. See
        // `normalizeJournalVisibility`.
        const normalized = normalizeJournalVisibility(value);
        if (normalized === undefined) {
          return refuse(
            "invalid_visibility",
            'visibility is "public" or "guest", and it decides only whether this server ' +
              "advertises the journal — on the landing page, in /documentation.txt and in the " +
              "sitemap. A guest journal is unlisted, not locked: who may read a journey is " +
              "still that trip's own visibility, though it is also this journal's answer for " +
              "a new trip's own default. Ask the person before making a journal public.",
          );
        }
        patch.visibility = normalized;
        break;
      }

      case "units": {
        if (value !== "metric" && value !== "imperial") {
          return refuse("invalid_units", 'units is "metric" or "imperial".');
        }
        patch.units = value;
        break;
      }

      case "locales": {
        if (!Array.isArray(value) || value.length === 0) {
          return refuse(
            "invalid_locales",
            'locales is a non-empty list of language codes, most preferred first: ["de", "en"]. ' +
              `This instance maintains ${LOCALE_LIST}, and a journal may offer those.`,
          );
        }
        const out: string[] = [];
        for (const item of value) {
          if (typeof item !== "string" || !LOCALE_TAG_RE.test(item)) {
            return refuse(
              "invalid_locales",
              `locales has ${JSON.stringify(item)}; each entry is a language code like "de" ` +
                `or "pt-BR", not a language name.`,
            );
          }
          if (!(MAINTAINED_LOCALES as readonly string[]).includes(item)) {
            // B777 — the same check `POST /api/v1/journals` makes, against the
            // same constant, in the same words. Creating a journal refused a
            // language this build ships no strings for; correcting one
            // accepted it and answered `200 {"ok":true}`, leaving an owner
            // with a journal whose config claims a language its readers will
            // never see. A field validated at creation and unvalidated
            // forever after is the same field twice with two different
            // meanings.
            return refuse(
              "invalid_locales",
              `locales has ${JSON.stringify(item)}; each entry must be one of ${LOCALE_LIST} — ` +
                "which of them a reader may switch the journal into.",
            );
          }
          if (!out.includes(item)) out.push(item);
        }
        patch.locales = out;
        break;
      }

      case "defaultLocale": {
        if (typeof value !== "string" || !LOCALE_TAG_RE.test(value)) {
          return refuse(
            "invalid_defaultLocale",
            `defaultLocale is a language code like "de", got ${JSON.stringify(value)}.`,
          );
        }
        if (!(MAINTAINED_LOCALES as readonly string[]).includes(value)) {
          // B777, and the create route's words: this one decides the chrome
          // and the language of the mail this server sends, so a code with no
          // strings behind it is a journal rendering in English while its
          // config says otherwise.
          return refuse(
            "invalid_defaultLocale",
            `defaultLocale must be one of ${LOCALE_LIST}, got ${JSON.stringify(value)}. ` +
              'Send the code, not the language\'s name — "Deutsch" and "German" are both "de".',
          );
        }
        patch.defaultLocale = value;
        break;
      }

      case "displayCurrencies": {
        if (!Array.isArray(value) || value.length === 0) {
          return refuse(
            "invalid_displayCurrencies",
            'displayCurrencies is a non-empty list of three-letter codes: ["CHF", "EUR"]. It is ' +
              "which currencies a reader can see the totals in.",
          );
        }
        const out: string[] = [];
        for (const item of value) {
          const code = typeof item === "string" ? normalizeCurrency(item) : null;
          if (!code) {
            return refuse(
              "invalid_displayCurrencies",
              `displayCurrencies has ${JSON.stringify(item)}; each entry is a three-letter ` +
                `currency code.`,
            );
          }
          if (!out.includes(code)) out.push(code);
        }
        const base = normalizeCurrency(user.baseCurrency) ?? user.baseCurrency.toUpperCase();
        if (!out.includes(base)) {
          return refuse(
            "invalid_displayCurrencies",
            `displayCurrencies must include this journal's base currency, ${base} — every ` +
              `total is computed in it, and a list without it is a config the site refuses to ` +
              `load. The base currency itself is not writable here.`,
          );
        }
        patch.displayCurrencies = out;
        break;
      }

      case "manualRates": {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          return refuse(
            "invalid_manualRates",
            'manualRates is an object of currency code to number: {"VND": 30500}. The ' +
              "convention is the ECB's — units of that currency for one EURO, so a currency " +
              "worth less than the euro has a LARGE number. This is the opposite direction " +
              "from a trip's own rates: block, which is base-per-unit. Send null for a code " +
              "to remove it.",
          );
        }
        // Merged rather than replaced, so a caller can correct one currency
        // without holding the rest of the table. `null` removes a code —
        // otherwise a rate typed wrongly could never be taken out again.
        const merged: Record<string, number> = { ...user.manualRates };
        for (const [rawCode, rawRate] of Object.entries(value as Record<string, unknown>)) {
          const code = normalizeCurrency(rawCode);
          if (!code) {
            return refuse(
              "invalid_manualRates",
              `manualRates has key "${rawCode}"; each key is a three-letter currency code.`,
            );
          }
          if (rawRate === null) {
            delete merged[code];
            continue;
          }
          const n = typeof rawRate === "string" ? Number(rawRate) : rawRate;
          if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
            return refuse(
              "invalid_manualRates",
              `manualRates.${code} must be a positive number of ${code} for one EUR, got ` +
                `${JSON.stringify(rawRate)}. Send null to remove it.`,
            );
          }
          merged[code] = n;
        }
        patch.manualRates = merged;
        break;
      }
    }
  }

  /**
   * The one cross-field rule, checked here rather than discovered by the
   * read-back.
   *
   * `parseUser` treats a `defaultLocale` outside `locales` as a config problem,
   * which takes the whole journal off the site — so without this the honest
   * outcome would be `write_failed` and a caller with no idea which half was
   * wrong. Checked against the *result*, so either field may arrive alone.
   */
  const nextLocales = (patch.locales as string[] | undefined) ?? user.locales;
  const nextDefault = (patch.defaultLocale as string | undefined) ?? user.defaultLocale;
  if (!nextLocales.includes(nextDefault)) {
    return refuse(
      "invalid_locales",
      `defaultLocale "${nextDefault}" is not in locales [${nextLocales.join(", ")}], and a ` +
        `journal whose config says that does not load at all. Send both together, or add the ` +
        `language before making it the default.`,
    );
  }

  const before = journalProfile(user);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changed: JournalProfileField[] = [];
  for (const field of JOURNAL_PROFILE_FIELDS) {
    // Cleared: a change only if there was something there to clear.
    if (remove.includes(field)) {
      if (before[field] !== "") changed.push(field);
    } else if (field in patch && !same(patch[field], before[field])) {
      changed.push(field);
    }
  }

  const written = editUserConfigFile(username, (raw) => {
    if (changed.length === 0) return null;
    const next = { ...raw, ...patch };
    for (const key of remove) delete next[key];
    // `ownerTel` is the one writable field that is not a key of its own: it
    // lives at `owner.tel`, one level down. Rewritten from `raw.owner` rather
    // than from the parsed `user.owner`, so a key this code does not know
    // about survives the edit.
    if ("ownerTel" in next || remove.includes("ownerTel")) {
      const owner = { ...(raw.owner as Record<string, unknown>) };
      const tel = next.ownerTel;
      delete next.ownerTel;
      if (typeof tel === "string" && tel) owner.tel = tel;
      else delete owner.tel;
      next.owner = owner;
    }
    return next;
  });
  if (!written.ok) return written;

  const now = getUser(username) ?? user;
  return { ok: true, username, journal: journalProfile(now), changed };
}
