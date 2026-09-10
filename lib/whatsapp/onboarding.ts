import "server-only";
import fs from "node:fs";
import path from "node:path";
import { NO_JOURNAL, isEmail, resolveSession, revokeSession, signInUrl, issueRelayLink, verifyCode, CODE_TTL_MINUTES } from "../auth";
import { isEnabled } from "../capabilities";
import { SIGNUP_CREDIT_GRANT, creditsEnabled, grant } from "../credits";
import { normalizeCurrency } from "../currency";
import { dataDir } from "../dataDir";
import { LOCALE_LABEL, MAINTAINED_LOCALES } from "../i18n";
import { createJournal, sendWelcome, setJournalFeatures } from "../journals";
import { translateIn } from "../locales";
import { rateLimitFor } from "../rateLimit";
import { sendSignupCode } from "../signupCode";
import { serverSite } from "../site";
import { isReservedUsername, isValidUsername, getUser } from "../users";
import type { InboundMessage } from "./inbound";
import { maskNumber } from "./index";
import { BUTTON_TITLE_MAX, truncate, type WhatsappOutbound } from "./render";
import { sendOutboundReply } from "./reply";

/**
 * Making a journal from inside WhatsApp — B1363.
 *
 * B1310 put "start using WhatsApp" on the landing page beside "Start
 * writing", on the reasoning that the channel explains itself to strangers
 * already. It did explain itself, and the explanation was a dead end: a
 * number no journal owns got one sentence telling it to go and use the
 * website. The one door on the landing page a person with no journal is most
 * likely to press was the one door that could not let them in.
 *
 * ## Why this is a script and not a model
 *
 * Every other conversation on this channel is a model turn
 * (`answerOnWhatsapp` in `./dispatch.ts`). This one is a `switch`, and three
 * separate reasons all point the same way:
 *
 * - **B1077.** Meta prohibits general-purpose AI chatbots, and the argument
 *   that the helper is on the right side of that line rests on it serving one
 *   narrow business process for one journal it already belongs to. A model
 *   that talks to strangers is a materially wider surface to make that
 *   argument over.
 * - **The disclosures have legal weight** (B1063, B1077), so they must read
 *   identically every time — AGENTS.md's own finding, one level down from the
 *   honesty guards: a sentence with consequences cannot be composed fresh.
 * - **There is no journal yet**, so there is nothing to spend a credit from.
 *   A model turn for a stranger would be the operator's own money, given away
 *   to anybody who knows the number.
 *
 * ## The questions are somebody else's list
 *
 * `firstQuestions()` in `lib/api/agentCopy.ts` is the canonical script — what
 * `/agent.md` prints for an outside agent and what `components/SignupWizard.tsx`
 * draws as a form. This is the third door onto the same list, in the same
 * order, and `test/whatsapp-onboarding.test.ts` checks the count so a
 * question added there cannot be silently missing here.
 *
 * Two are shaped by the channel rather than by the list:
 *
 * - **Language comes first**, because a webhook carries no `Accept-Language`
 *   and a stranger's number belongs to no journal to read a locale off. Until
 *   it is answered there is no honest language to ask anything else in, so
 *   the first message is the only one in this file that is not in the
 *   person's own tongue.
 * - **`locales` is a yes/no and then one pick.** The web form offers
 *   checkboxes; WhatsApp has three buttons or a list of ten. Two languages is
 *   the commitment worth warning about (B294 refuses a day missing one) and a
 *   third is `PATCH /api/v1/<user>/config` away, so the honest reduction is
 *   "your language, or one more".
 *
 * ## What proves what
 *
 * **The number is already proven** — B1234's insight, pointed the other way.
 * The web signup mints an `FS-` token for somebody to send *from* their
 * phone; here the message *is* the arrival, so `owner.telProvenMethod` is
 * `whatsapp-inbound` for the same reason and with the same weight. The
 * address is proven the same way every other door proves one: a six-digit
 * code, mailed, five attempts, superseded on reissue (`lib/signupCode.ts`).
 *
 * **No token is minted at the end**, and none is needed: the tel registry
 * (B1064) now names this journal, so the very next message that number sends
 * is an owner's message. It walks into the ordinary bound path in
 * `./dispatch.ts` — ungreeted, so B1058's three disclosures and B1138's
 * acknowledgement gate happen exactly where they already do, rather than
 * being quietly satisfied by this flow having said something similar.
 */

/** Where a half-finished signup lives while it is being had.
 *
 *  `dataDir()` and not `contentRoot()`: there is no journal for it to belong
 *  to (that is the whole point of it), `content/` takes nothing but a journal
 *  since B510, and it is transient state a backup and an export have no
 *  business carrying — the same reasoning that moved sent mail out in B636. */
function stateDir(): string {
  return path.join(dataDir(), "whatsapp-onboarding");
}

/** Abandoned halfway through, and picked up again a day later, is a fresh
 *  start rather than a resumption of a conversation nobody remembers. Long
 *  enough that "I'll find that email in the morning" works. */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How much of this one number may cost the operator in a day.
 *
 * Every ceiling here is keyed on the number, because that is the one thing
 * this channel actually knows: a webhook arrives from Meta, so
 * `lib/rateLimit.ts`'s usual per-IP bucketing would put the whole world in
 * one bucket. The mail ceiling is the one that matters — it is the only thing
 * in this flow that leaves the building before a journal exists.
 */
const MAILS_PER_NUMBER = { max: 5, windowMs: TTL_MS };
const JOURNALS_PER_NUMBER = { max: 2, windowMs: TTL_MS };
/** And one for the instance, so a farm of numbers is bounded too. */
const MAILS_PER_INSTANCE = { max: 100, windowMs: TTL_MS };

type Stage =
  | "language"
  | "email"
  | "code"
  | "title"
  | "username"
  | "name"
  | "nickname"
  | "visibility"
  | "readers"
  | "readersPick"
  | "currency";

type State = {
  tel: string;
  stage: Stage;
  /** Empty until the language question is answered — the only stage that runs
   *  without one, and the reason it is asked first. */
  locale: string;
  /** How many messages at this stage were not an answer to it. Kept so a
   *  reader who replied to a day announcement, or a wrong number, is answered
   *  once and then left alone rather than argued with. */
  misses: number;
  email?: string;
  title?: string;
  username?: string;
  ownerName?: string;
  ownerNickname?: string;
  visibility?: "public" | "guest";
  locales?: string[];
  baseCurrency?: string;
  startedAt: string;
  updatedAt: string;
};

/** The same refusal `lib/registry.ts` makes of a registry key, for the same
 *  reason: this string becomes a filename. */
function stateFile(tel: string): string {
  if (!/^\d{1,15}$/.test(tel)) {
    throw new Error(`refusing to use a non-E.164 value as an onboarding key: ${JSON.stringify(tel)}`);
  }
  return path.join(stateDir(), `${tel}.json`);
}

function readState(tel: string): State | null {
  let raw: string;
  try {
    raw = fs.readFileSync(stateFile(tel), "utf8");
  } catch {
    return null;
  }
  let state: State;
  try {
    state = JSON.parse(raw) as State;
  } catch {
    // A half-written file is worth starting over from, not crashing on.
    forget(tel);
    return null;
  }
  if (Date.now() - new Date(state.updatedAt).getTime() > TTL_MS) {
    forget(tel);
    return null;
  }
  return state;
}

function save(state: State): void {
  state.updatedAt = new Date().toISOString();
  const file = stateFile(state.tel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function forget(tel: string): void {
  fs.rmSync(stateFile(tel), { force: true });
}

/**
 * Whether this instance can finish what a stranger's message would start.
 *
 * `signup` and `mail` both, and absent rather than broken when either is off
 * — an instance that cannot mail a code cannot prove an address, and walking
 * somebody four questions in before finding that out would be worse than the
 * dead-end sentence this replaces. Where it answers false, `./dispatch.ts`
 * falls back to exactly the sentence it always sent.
 */
export function onboardingOffered(): boolean {
  return isEnabled("signup") && isEnabled("mail");
}

const BUTTON_MAX = 3;

/** Every title on this channel goes through `truncate` at Meta's own
 *  twenty-character ceiling — `./render.ts`'s rule for the model's buttons,
 *  and no less true of these. A title over the ceiling is not a long button:
 *  it is a message the Graph API refuses outright, which on this flow would
 *  be a question nobody is ever asked. */
function option(id: string, title: string): { id: string; title: string } {
  return { id, title: truncate(title, BUTTON_TITLE_MAX) };
}

/** A pick of one code from a short list, as buttons if they fit and a list if
 *  they do not — Meta allows three of the former and ten of the latter, and
 *  `MAINTAINED_LOCALES` is at three today. Written this way so a fourth
 *  language is a translation job and not a broken message. */
function chooseCode(body: string, prefix: string, codes: readonly string[], listLabel: string): WhatsappOutbound {
  const options = codes.map((code) => option(`${prefix}:${code}`, LOCALE_LABEL[code] ?? code));
  if (options.length <= BUTTON_MAX) return { kind: "buttons", body, buttons: options };
  return { kind: "list", body, buttonLabel: truncate(listLabel, BUTTON_TITLE_MAX), rows: options.slice(0, 10) };
}

/**
 * The question this state is waiting for the answer to.
 *
 * One function rather than a sentence beside each transition, so that asking
 * and *re*-asking cannot drift apart: a miss sends its own short correction
 * followed by exactly the question that was already on the table.
 */
function question(state: State): WhatsappOutbound {
  const site = serverSite();
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(state.locale, key, vars);

  switch (state.stage) {
    case "language":
      // The one message in this file that cannot be in the person's own
      // language, because which that is has not been established yet. Its
      // English text carries the other two tongues with it.
      return chooseCode(
        translateIn("en", "wa.onb.card", { site: site.name }),
        "onb:lang",
        MAINTAINED_LOCALES,
        translateIn("en", "wa.onb.pickLanguageLabel"),
      );
    case "email":
      return {
        kind: "text",
        body: `${t("wa.onb.disclosure", { site: site.name, url: site.url })}\n\n${t("wa.onb.askEmail")}`,
      };
    case "code":
      return { kind: "text", body: t("wa.onb.askCode", { email: state.email ?? "", minutes: CODE_TTL_MINUTES }) };
    case "title":
      return { kind: "text", body: t("wa.onb.askTitle") };
    case "username":
      return { kind: "text", body: t("wa.onb.askUsername", { url: site.url }) };
    case "name":
      return { kind: "text", body: t("wa.onb.askName") };
    case "nickname":
      return { kind: "text", body: t("wa.onb.askNickname", { name: state.ownerName ?? "" }) };
    case "visibility":
      return {
        kind: "buttons",
        body: t("wa.onb.askVisibility"),
        buttons: [option("onb:vis:public", t("wa.onb.visPublic")), option("onb:vis:guest", t("wa.onb.visGuest"))],
      };
    case "readers": {
      const own = LOCALE_LABEL[state.locale] ?? state.locale;
      return {
        kind: "buttons",
        body: t("wa.onb.askReaders", { language: own }),
        buttons: [
          option("onb:readers:one", t("wa.onb.readersOne", { language: own })),
          option("onb:readers:more", t("wa.onb.readersMore")),
        ],
      };
    }
    case "readersPick":
      return chooseCode(
        t("wa.onb.pickReaders"),
        "onb:reader",
        MAINTAINED_LOCALES.filter((code) => code !== state.locale),
        t("wa.onb.pickLanguageLabel"),
      );
    case "currency":
      return { kind: "text", body: t("wa.onb.askCurrency") };
  }
}

/** Said by somebody who wants out, in any of the three languages and in the
 *  two words every WhatsApp user already knows. Matched before anything else
 *  at every stage, because a person who has changed their mind must not have
 *  to finish. */
const STOP_WORDS = new Set(["stop", "stopp", "abbrechen", "abbruch", "cancel", "mégse", "megse", "leállítás", "nein danke"]);

/** What the person said, whether they typed it or tapped it. A tap's own
 *  title is read as though typed — `lib/whatsapp/render.ts`'s rule for every
 *  other button on this channel — so somebody who types "Deutsch" and
 *  somebody who presses it end up in the same branch. */
function saidBy(message: InboundMessage): { text: string; id: string } | null {
  if (message.kind === "text") return { text: message.body.trim(), id: "" };
  if (message.kind === "interactive") return { text: message.title.trim(), id: message.replyId };
  return null;
}

/** A code picked either by its button id (`onb:lang:de`) or by its label
 *  typed back ("Deutsch"). */
function codeFrom(said: { text: string; id: string }, prefix: string, codes: readonly string[]): string | null {
  const tapped = said.id.startsWith(`${prefix}:`) ? said.id.slice(prefix.length + 1) : "";
  if (codes.includes(tapped)) return tapped;
  const typed = said.text.toLowerCase();
  return (
    codes.find((code) => (LOCALE_LABEL[code] ?? code).toLowerCase() === typed || code === typed) ?? null
  );
}

/**
 * One inbound message from a number no journal owns.
 *
 * `true` means this module answered for it and `./dispatch.ts` should stop;
 * `false` means it did not, and the stranger sentence still applies.
 */
export async function handleOnboarding(message: InboundMessage): Promise<boolean> {
  const tel = message.from;
  let state = readState(tel);

  const said = saidBy(message);

  if (!state) {
    // Nothing in flight: whatever this message was, the answer is the offer.
    state = {
      tel,
      stage: "language",
      locale: "",
      misses: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    save(state);
    await sendOutboundReply(tel, question(state), null);
    console.log(`[whatsapp:onboarding] offered a journal to ${maskNumber(tel)}`);
    return true;
  }

  if (!said) {
    // A photograph or a voice note where an answer was expected. One sentence
    // and the question again — bounded, since every one of these is a thing
    // somebody deliberately sent.
    await sendOutboundReply(tel, { kind: "text", body: translateIn(state.locale || "en", "wa.onb.needText") }, null);
    await sendOutboundReply(tel, question(state), null);
    return true;
  }

  if (STOP_WORDS.has(said.text.toLowerCase())) {
    const locale = state.locale || "en";
    forget(tel);
    await sendOutboundReply(tel, { kind: "text", body: translateIn(locale, "wa.onb.cancelled") }, null);
    console.log(`[whatsapp:onboarding] ${maskNumber(tel)} stopped at the ${state.stage} stage`);
    return true;
  }

  const advance = async (next: Stage): Promise<true> => {
    state.stage = next;
    state.misses = 0;
    save(state);
    await sendOutboundReply(tel, question(state), null);
    return true;
  };

  /** A message that was not an answer to the question on the table. The
   *  correction, then the question again — but only twice: past that, silence
   *  is the honest reading of a number that is not doing this. B1302's
   *  finding (silence is indistinguishable from a broken robot) is why it is
   *  twice rather than once, and a wrong number is why it is not forever. */
  const miss = async (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>): Promise<true> => {
    state.misses += 1;
    save(state);
    if (state.misses > 2) {
      console.log(`[whatsapp:onboarding] ${maskNumber(tel)} said nothing usable at ${state.stage}; quiet now`);
      return true;
    }
    await sendOutboundReply(tel, { kind: "text", body: translateIn(state.locale || "en", key, vars) }, null);
    await sendOutboundReply(tel, question(state), null);
    return true;
  };

  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(state.locale, key, vars);
  const say = async (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>): Promise<true> => {
    await sendOutboundReply(tel, { kind: "text", body: t(key, vars) }, null);
    return true;
  };

  switch (state.stage) {
    case "language": {
      const code = codeFrom(said, "onb:lang", MAINTAINED_LOCALES);
      if (!code) return miss("wa.onb.needLanguage");
      state.locale = code;
      return advance("email");
    }

    case "email": {
      if (!isEmail(said.text)) return miss("wa.onb.emailBad");
      const email = said.text.trim();
      if (!rateLimitFor("wa-onboard-mail", tel, MAILS_PER_NUMBER).ok) return say("wa.onb.tooMuch");
      if (!rateLimitFor("wa-onboard-mail-instance", "*", MAILS_PER_INSTANCE).ok) return say("wa.onb.tooMuch");
      if (!(await sendSignupCode(email, state.locale))) return say("wa.onb.mailFailed");
      state.email = email;
      console.log(`[whatsapp:onboarding] mailed a code for ${maskNumber(tel)}`);
      return advance("code");
    }

    case "code": {
      // Somebody who cannot find the mail sends their address again rather
      // than a code — read as "send me another", which is what they mean.
      if (isEmail(said.text)) {
        state.stage = "email";
        state.misses = 0;
        save(state);
        return handleOnboarding(message);
      }
      const digits = said.text.replace(/\s+/g, "");
      const result = await verifyCode(NO_JOURNAL, state.email ?? "", digits, "signup");
      if (!result.ok) return miss("wa.onb.codeWrong");
      /**
       * The address is proven; the session it minted is not wanted.
       *
       * `verifyCode` is the only door onto the six-digit discipline (five
       * attempts, single use, superseded on reissue) and it mints a signup
       * token as its answer. Nothing here holds one — the journal is written
       * from this module, not over HTTP — so it is spent immediately rather
       * than left to lie around for its twenty minutes as a credential
       * nobody asked for and nobody is holding.
       */
      const session = await resolveSession(result.token, "signup");
      if (session) await revokeSession(session.id).catch(() => {});
      return advance("title");
    }

    case "title": {
      const title = said.text.slice(0, 80).trim();
      if (title.length < 2) return miss("wa.onb.titleBad");
      state.title = title;
      return advance("username");
    }

    case "username": {
      const wanted = said.text.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
      if (!isValidUsername(wanted)) return miss("wa.onb.usernameBad");
      // Asked here rather than discovered at the end, where four more
      // questions would already have been answered against a name that was
      // never available. `createJournal` checks all of this again and is
      // still the authority — this is only about asking at the right moment.
      if (getUser(wanted) || isReservedUsername(wanted)) return miss("wa.onb.usernameTaken");
      state.username = wanted;
      return advance("name");
    }

    case "name": {
      const name = said.text.slice(0, 80).trim();
      if (name.length < 2) return miss("wa.onb.nameBad");
      state.ownerName = name;
      return advance("nickname");
    }

    case "nickname": {
      // Never inferred from `ownerName` — `firstQuestions()`'s own rule, and
      // the mistake these two fields exist to stop.
      const nickname = said.text.slice(0, 40).trim();
      if (nickname.length < 1) return miss("wa.onb.nameBad");
      state.ownerNickname = nickname;
      return advance("visibility");
    }

    case "visibility": {
      const tapped = said.id === "onb:vis:public" ? "public" : said.id === "onb:vis:guest" ? "guest" : "";
      const typed = said.text.toLowerCase();
      const chosen =
        tapped ||
        (typed === t("wa.onb.visPublic").toLowerCase() || typed === "public"
          ? "public"
          : typed === t("wa.onb.visGuest").toLowerCase() || typed === "guest"
            ? "guest"
            : "");
      if (chosen !== "public" && chosen !== "guest") return miss("wa.onb.needChoice");
      state.visibility = chosen;
      return advance("readers");
    }

    case "readers": {
      const typed = said.text.toLowerCase();
      const own = LOCALE_LABEL[state.locale] ?? state.locale;
      const one =
        said.id === "onb:readers:one" || typed === t("wa.onb.readersOne", { language: own }).toLowerCase();
      const more = said.id === "onb:readers:more" || typed === t("wa.onb.readersMore").toLowerCase();
      if (!one && !more) return miss("wa.onb.needChoice");
      if (one) {
        state.locales = [state.locale];
        return advance("currency");
      }
      return advance("readersPick");
    }

    case "readersPick": {
      const others = MAINTAINED_LOCALES.filter((code) => code !== state.locale);
      const code = codeFrom(said, "onb:reader", others);
      if (!code) return miss("wa.onb.needLanguage");
      state.locales = [state.locale, code];
      return advance("currency");
    }

    case "currency": {
      const currency = normalizeCurrency(said.text);
      if (!currency) return miss("wa.onb.currencyBad");
      state.baseCurrency = currency;
      save(state);
      return finish(state);
    }
  }
}

/**
 * Every question answered: write the journal.
 *
 * `createJournal` directly, the way every other tool in this codebase reaches
 * a write it could also have made over HTTP (`./dispatch.ts`'s own location
 * pin calls `createDraft` for the same reason). What `POST /api/v1/journals`
 * does either side of it and this has to do too is the grant and the welcome
 * letter; what it does that this does not is mint an agent token, which
 * nothing here would hold.
 */
async function finish(state: State): Promise<true> {
  const tel = state.tel;
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(state.locale, key, vars);
  const site = serverSite();

  if (!rateLimitFor("wa-onboard-create", tel, JOURNALS_PER_NUMBER).ok) {
    await sendOutboundReply(tel, { kind: "text", body: t("wa.onb.tooMuch") }, null);
    return true;
  }

  const created = createJournal({
    username: state.username ?? "",
    title: state.title ?? "",
    ownerEmail: state.email ?? "",
    ownerName: state.ownerName ?? "",
    ownerNickname: state.ownerNickname ?? "",
    visibility: state.visibility ?? "guest",
    defaultLocale: state.locale,
    locales: state.locales ?? [state.locale],
    baseCurrency: state.baseCurrency ?? "",
    ownerTel: tel,
    ownerTelProvenAt: new Date().toISOString(),
    // The message arriving from this number is the proof — the same method
    // `lib/phoneVerify/inboundLink.ts` records, reached from the other side.
    ownerTelProvenMethod: "whatsapp-inbound",
  });

  if (!created.ok) {
    console.error(`[whatsapp:onboarding] could not create a journal for ${maskNumber(tel)}: ${created.error}`);
    if (created.error === "username_taken") {
      // Correctable in the conversation rather than a reason to start over —
      // `POST /api/v1/journals`'s own promise about a taken name, kept here.
      state.stage = "username";
      state.misses = 0;
      save(state);
      await sendOutboundReply(tel, { kind: "text", body: t("wa.onb.usernameTaken") }, null);
      await sendOutboundReply(tel, question(state), null);
      return true;
    }
    if (created.error === "email_taken" || created.error === "too_many_journals") {
      forget(tel);
      await sendOutboundReply(tel, { kind: "text", body: t("wa.onb.emailTaken", { url: site.url }) }, null);
      return true;
    }
    await sendOutboundReply(tel, { kind: "text", body: t("wa.onb.failed", { url: site.url }) }, null);
    return true;
  }

  /**
   * The channel this journal was made through, switched on for it.
   *
   * `whatsappInbound` is opt-in per journal (B611), and off by default — so
   * without this the person's *next* message is dropped with
   * "which has not opted into the channel" in a log nobody reads, having just
   * answered nine questions here. Consent is not being assumed: they created
   * the journal inside this conversation, which is the strongest signal there
   * is for this one capability.
   *
   * **Only this one.** `whatsapp` — day announcements to readers — is a
   * different capability that spends credits per message and belongs to a
   * decision nobody has made yet; it keeps its own default.
   */
  const opted = setJournalFeatures(created.username, { whatsappInbound: true });
  if (!opted.ok) {
    console.error(`[whatsapp:onboarding] could not switch the channel on for ${created.username}: ${opted.error}`);
  }

  /**
   * The free grant, so the first day costs nothing — the same fixed
   * `SIGNUP_CREDIT_GRANT` `POST /api/v1/journals` gives, for the same reason,
   * and after the journal is already on disk so a ledger hiccup cannot undo
   * a journal. This module is named in `GRANT_ALLOWED` in
   * `test/credits.test.ts`; that list is the review, and B1363 widened its
   * walk to `lib/` because this is the first grant caller outside `app/`.
   */
  if (creditsEnabled()) {
    try {
      await grant(created.username, SIGNUP_CREDIT_GRANT, "signup");
    } catch (err) {
      console.error(`[whatsapp:onboarding] could not grant the signup credit to ${created.username}:`, err);
    }
  }

  await sendWelcome({
    username: created.username,
    title: state.title ?? "",
    email: state.email ?? "",
    nickname: state.ownerNickname ?? "",
    visibility: created.visibility,
    locale: state.locale,
  });

  /**
   * A way in, on the screen they are already looking at.
   *
   * The same fifteen-minute single-use relay link `POST /api/v1/journals`
   * hands an agent to pass on (B29), for the same reason: a person who has
   * just answered nine questions on their phone should not have to go and
   * find an email to see what they made. Best effort — the welcome letter
   * carries a standing link to the same place, so a journal with no relay
   * link is a journal, not a failure.
   */
  let signIn: string | null = null;
  if (isEnabled("auth", created.username)) {
    try {
      signIn = signInUrl(site.url, created.username, await issueRelayLink(created.username, state.email ?? ""));
    } catch (err) {
      console.error(`[whatsapp:onboarding] no relay link for ${created.username}:`, err);
    }
  }

  forget(tel);
  const url = `${site.url}/${created.username}`;
  await sendOutboundReply(
    tel,
    { kind: "text", body: signIn ? t("wa.onb.done", { url, signIn }) : t("wa.onb.doneNoLink", { url }) },
    // Still `null`: the journal exists, but this is the reply to the message
    // that made it, and no window has been marked under the new username yet.
    null,
  );
  console.log(`[whatsapp:onboarding] ${maskNumber(tel)} created ${created.username} over WhatsApp`);
  return true;
}
