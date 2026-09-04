"use client";

import { useState } from "react";
import { codeConfirmErrorKey } from "@/lib/contacts/codeConfirmError";
import { LOCALE_LABEL, translate, type TranslationKey } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

/**
 * Redeeming a guest or a buddy link — B33.
 *
 * Two things it always needs — **a name, and an address it can prove** —
 * because being let into somebody's journal needs nothing else, and a
 * redemption must never quietly rewrite a choice an already-known reader
 * already made: no digest tick, and no postal address either. **That is the
 * returning reader's rule and not the whole story** — B273 gave a brand-new
 * reader the address and the phone number, and B315 the digest tick, on the
 * reasoning that somebody with no existing choice has nothing to overwrite,
 * only a first one to make. Both are on the "form" step alone.
 * Those still belong on the reader's own manage page, `/{username}/c/<token>`,
 * where they can be added, corrected or removed in the open — never here,
 * for somebody who is signed in already or whose email this journal already
 * knows.
 *
 * A **brand-new** reader sees more, since B273: a postal address and a phone
 * number, both optional, on the same "form" step as the name and the email —
 * the same fields the guestbook (`ContactForm`) has always asked for. There is
 * no existing choice on this screen to overwrite, only a first one to make, so
 * offering the two together here saves a second trip to the manage page for
 * whoever wants to give an address at all.
 *
 * Each of the two identity fields is skipped when it is already known:
 *
 * - Signed in to this journal already, and the address is proved. The whole
 *   screen collapses to one button — no email box, no six digits, no second
 *   mail, and (for the same reason) no address fields either. Somebody who
 *   already has a journal on this instance and is reading this one is the
 *   expected case, not the edge case.
 * - Known here already, and the name on file stands. It is shown, and it can
 *   be corrected, and leaving it alone changes nothing.
 *
 * What it never does is tell somebody they are in. Redeeming is asking; the
 * last screen says so in those words, because a form that appears to succeed
 * and then goes quiet leaves people waiting for a reply that never comes.
 *
 * **The email field prefills, but only from a mailed invite — B338.** When
 * `invitedEmail` is set, the address is already the one the owner asked to
 * have this link mailed to, and typing over it means falling out of B319's
 * pre-approval into the ordinary queue with no explanation on the owner's
 * side. `invite.emailPrefilledHint`, shown beside the field exactly when it
 * was prefilled, is that explanation. See `invitedEmail`'s own doc comment
 * below, and the one on `RedeemPage`, for why prefilling is judged safe
 * against "safe to forward" and why the value shown is the case-folded
 * `email_key` rather than a second stored copy of the address as typed.
 */

type Step = "form" | "confirm" | "code" | "waiting" | "in";

const FIELD =
  "mt-2 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-lg text-navy-900";
const LABEL = "block text-base font-medium text-navy-700";
const BUTTON =
  "mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-yellow-400 px-6 text-lg font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-60 sm:w-auto";

export default function InviteRedeem({
  username,
  journalTitle,
  kind,
  tripTitle,
  token,
  initialLocale,
  locales,
  dictionaries,
  knownEmail,
  initialName,
  invitedEmail,
  alreadyIn,
}: {
  username: string;
  journalTitle: string;
  kind: "guest" | "buddy";
  /** The trip a buddy link joins, for saying which one they are being asked
   * onto. Null for a guest link, which is journal-wide by design. */
  tripTitle: string | null;
  token: string;
  initialLocale: Locale;
  locales: string[];
  dictionaries: Record<string, Record<string, string>>;
  /** The address on a session **for this journal**. Its presence is what turns
   * the form into a single button; it is never sent to the server, which reads
   * the session itself. */
  knownEmail: string | null;
  initialName: string;
  /**
   * The address this invite was mailed to — B338. Null for a link the owner
   * copied by hand, which prefills nothing here, unchanged from before this
   * ticket. Only ever reaches this component when there is no `knownEmail`
   * already (a signed-in reader is shown the "confirm" step instead, which
   * has no email field to prefill).
   */
  invitedEmail: string | null;
  /** They already hold everything this link leads to. */
  alreadyIn: boolean;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [step, setStep] = useState<Step>(
    alreadyIn ? "in" : knownEmail ? "confirm" : "form",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [code, setCode] = useState("");
  // Only offered on the "form" step — a brand-new reader, never asked before
  // (B273). Untouched on "confirm": an already-known reader is never shown
  // these, and the request body below reflects that by leaving them out
  // entirely rather than sending them empty.
  //
  // The digest starts ticked and the postcard does not — B315, and the same
  // split `ContactForm` has always had. A travel journal's guest expects to be
  // told when there is a new day; a postcard is the rarer, more involved
  // thing, and it asks for a street address. Ticking by default is safe here
  // in a way it would not be on a form that could itself cause mail: nothing
  // is sent on the strength of this box. The address still has to be
  // confirmed by code and then approved by the owner before a single digest
  // goes out, and every digest carries a one-click unsubscribe.
  const [wantsDigest, setWantsDigest] = useState(true);
  const [wantsPostcard, setWantsPostcard] = useState(false);
  const [address, setAddress] = useState({
    name: "",
    line1: "",
    line2: "",
    postcode: "",
    city: "",
    country: "",
    tel: "",
  });

  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translate(dictionaries[locale] ?? dictionaries.en ?? {}, key, vars);

  const what = kind === "buddy" ? (tripTitle ?? journalTitle) : journalTitle;

  function setAddressField(field: keyof typeof address, value: string) {
    setAddress((previous) => ({ ...previous, [field]: value }));
    // Typing a street plainly means they want the postcard; ticking the box
    // for them saves a step, and it stays a box they can untick — the same
    // behaviour `ContactForm` uses for the same reason.
    if (value.trim() !== "") setWantsPostcard(true);
  }

  // A phone number is not a postal address, and giving one is not asking for
  // a postcard — unlike `setAddressField` above, typing a `tel` must never
  // tick that box for them.
  function setTel(value: string) {
    setAddress((previous) => ({ ...previous, tel: value }));
  }

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!knownEmail) {
      if (name.trim() === "") return setError("contact.needName");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
        return setError("contact.needEmail");
      }
      if (
        wantsPostcard &&
        (address.line1.trim() === "" || address.city.trim() === "" || address.country.trim() === "")
      ) {
        return setError("contact.needAddress");
      }
    }

    setBusy(true);
    const response = await fetch("/api/contacts/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user: username,
        token,
        kind,
        name,
        locale,
        // No email when the session carries one: the server reads it off the
        // cookie, and a body that could name an address would be a way of
        // confirming somebody else's. The address and the postcard consent
        // are the same story: sent only on the "form" step, where they were
        // actually asked for — the confirm step must never answer for an
        // already-known reader (B273's doc comment above explains why).
        ...(knownEmail ? {} : { email, address, wantsPostcard, wantsEmailDigest: wantsDigest }),
      }),
    }).catch(() => null);
    setBusy(false);

    if (!response) return setError("contact.error");
    if (response.status === 429) return setError("contact.tooMany");
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (body.error === "invalid_email") return setError("contact.needEmail");
      if (body.error === "invalid_name") return setError("contact.needName");
      // The client already checked this before sending; the server checks
      // again because the client is not the boundary (B273).
      if (body.error === "invalid_address") return setError("contact.needAddress");
      // The server cannot send the code this needs (B205). Said in words
      // rather than as "something went wrong", because there is nothing the
      // reader can do differently and waiting for a mail that is not coming is
      // what the old answer left them doing.
      if (body.error === "mail_disabled") return setError("invite.noMail");
      return setError("contact.error");
    }

    const body = (await response.json().catch(() => ({}))) as { status?: string };
    if (body.status === "expired") return setError("invite.expired");
    if (body.status === "in") return setStep("in");
    if (body.status === "waiting") return setStep("waiting");
    setStep("code");
  }

  /** The same six digits and the same endpoint the guestbook uses — one code
   * mechanism for the whole site. */
  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const response = await fetch("/api/contacts/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, email, code }),
    }).catch(() => null);
    setBusy(false);

    if (!response) return setError("contact.error");
    if (response.status === 429) return setError("contact.tooMany");
    if (!response.ok) {
      // Only a rejected code (401) is worth retyping — see codeConfirmError.ts.
      if (response.status === 401) setCode("");
      return setError(codeConfirmErrorKey(response.status));
    }
    const body = (await response.json()) as { status?: string };
    setStep(body.status === "active" ? "in" : "waiting");
  }

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-12 sm:py-16" lang={locale}>
      <h1 className="font-display text-3xl leading-tight text-navy-900 sm:text-4xl">
        {step === "in"
          ? t("invite.inTitle")
          : step === "waiting"
            ? t("invite.waitingTitle")
            : step === "code"
              ? t("contact.codeTitle")
              : kind === "buddy"
                ? t("invite.buddyTitle", { what })
                : t("invite.guestTitle", { title: journalTitle })}
      </h1>

      {(step === "form" || step === "confirm") && (
        <form onSubmit={redeem} noValidate>
          <p className="mt-3 text-lg leading-relaxed text-navy-700">
            {kind === "buddy"
              ? t("invite.buddyIntro", { what, title: journalTitle })
              : t("invite.guestIntro", { title: journalTitle })}
          </p>

          {step === "confirm" ? (
            <p className="mt-6 rounded-2xl border border-navy-200 bg-cream-100 p-5 text-lg text-navy-800">
              {t("invite.confirmAs", { email: knownEmail ?? "" })}
            </p>
          ) : (
            <>
              <div className="mt-8">
                <label className={LABEL} htmlFor="invite-name">
                  {t("contact.name")}
                </label>
                <input
                  id="invite-name"
                  className={FIELD}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="mt-6">
                <label className={LABEL} htmlFor="invite-email">
                  {t("contact.email")}
                </label>
                <input
                  id="invite-email"
                  className={FIELD}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p className="mt-2 text-base text-navy-600">{t("contact.emailHint")}</p>
                {/* B338 — the sentence that matters more than the prefill
                    itself. Shown whenever this link carried an address to
                    prefill, regardless of whether the reader has since
                    edited the field: the point is to say, before they
                    submit, what changing it costs — falling out of
                    pre-approval and into the owner's queue with no
                    explanation there. Never shown for a hand-copied link,
                    which never prefilled anything to begin with. */}
                {invitedEmail && (
                  <p className="mt-2 text-base text-navy-600">
                    {t("invite.emailPrefilledHint", { email: invitedEmail })}
                  </p>
                )}
              </div>

              <div className="mt-6">
                <label className={LABEL} htmlFor="invite-locale">
                  {t("contact.language")}
                </label>
                <select
                  id="invite-locale"
                  className={FIELD}
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as Locale)}
                >
                  {locales.map((option: string) => (
                    <option key={option} value={option}>
                      {LOCALE_LABEL[option]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Both optional, and both new since B273 — a brand-new reader
                  is the only one ever shown these (the "confirm" branch above
                  never renders this far). No existing choice for this screen
                  to overwrite, only a first one to make. */}
              <div className="mt-6">
                <label className={LABEL} htmlFor="invite-tel">
                  {`${t("contact.tel")} (${t("contact.optional")})`}
                </label>
                <input
                  id="invite-tel"
                  className={FIELD}
                  type="tel"
                  autoComplete="tel"
                  value={address.tel}
                  onChange={(e) => setTel(e.target.value)}
                />
                <p className="mt-2 text-base text-navy-600">{t("contact.telHint")}</p>
              </div>

              <fieldset className="mt-10 rounded-2xl border border-navy-200 bg-cream-100 p-5">
                <legend className="px-2 font-display text-xl text-navy-900">
                  {t("contact.address")}
                </legend>
                <p className="text-base text-navy-700">{t("contact.addressHint")}</p>

                <div className="mt-4">
                  <label className={LABEL} htmlFor="invite-addr-name">
                    {t("contact.addrName")}
                  </label>
                  <input
                    id="invite-addr-name"
                    className={FIELD}
                    value={address.name}
                    onChange={(e) => setAddressField("name", e.target.value)}
                  />
                </div>
                <div className="mt-4">
                  <label className={LABEL} htmlFor="invite-addr-line1">
                    {t("contact.addrLine1")}
                  </label>
                  <input
                    id="invite-addr-line1"
                    className={FIELD}
                    autoComplete="address-line1"
                    value={address.line1}
                    onChange={(e) => setAddressField("line1", e.target.value)}
                  />
                </div>
                <div className="mt-4">
                  <label className={LABEL} htmlFor="invite-addr-line2">
                    {`${t("contact.addrLine2")} (${t("contact.optional")})`}
                  </label>
                  <input
                    id="invite-addr-line2"
                    className={FIELD}
                    autoComplete="address-line2"
                    value={address.line2}
                    onChange={(e) => setAddressField("line2", e.target.value)}
                  />
                </div>
                <div className="mt-4 flex gap-4">
                  <div className="w-1/3">
                    <label className={LABEL} htmlFor="invite-addr-postcode">
                      {t("contact.addrPostcode")}
                    </label>
                    <input
                      id="invite-addr-postcode"
                      className={FIELD}
                      autoComplete="postal-code"
                      value={address.postcode}
                      onChange={(e) => setAddressField("postcode", e.target.value)}
                    />
                  </div>
                  <div className="flex-1">
                    <label className={LABEL} htmlFor="invite-addr-city">
                      {t("contact.addrCity")}
                    </label>
                    <input
                      id="invite-addr-city"
                      className={FIELD}
                      autoComplete="address-level2"
                      value={address.city}
                      onChange={(e) => setAddressField("city", e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <label className={LABEL} htmlFor="invite-addr-country">
                    {t("contact.addrCountry")}
                  </label>
                  <input
                    id="invite-addr-country"
                    className={FIELD}
                    autoComplete="country-name"
                    value={address.country}
                    onChange={(e) => setAddressField("country", e.target.value)}
                  />
                </div>
              </fieldset>

              {/* Two questions, two boxes. "Write to me" and "post me
                  something" have different consequences and are never
                  answered at once — the same block, in the same order, as
                  `ContactForm`: one contacts table should not be filled by two
                  forms that disagree about what was asked. B315. */}
              <div className="mt-8 space-y-4">
                <label className="flex items-start gap-3 text-lg text-navy-900">
                  <input
                    type="checkbox"
                    className="mt-1.5 size-5"
                    checked={wantsDigest}
                    onChange={(e) => setWantsDigest(e.target.checked)}
                  />
                  <span>{t("contact.wantsDigest")}</span>
                </label>
                <label className="flex items-start gap-3 text-lg text-navy-900">
                  <input
                    type="checkbox"
                    className="mt-1.5 size-5"
                    checked={wantsPostcard}
                    onChange={(e) => setWantsPostcard(e.target.checked)}
                  />
                  <span>{t("contact.wantsPostcard")}</span>
                </label>
              </div>
            </>
          )}

          <p className="mt-6 text-base leading-relaxed text-navy-600">{t("invite.notYet")}</p>

          {error && <p className="mt-6 text-lg text-red-700">{t(error)}</p>}
          <button className={BUTTON} disabled={busy} type="submit">
            {step === "confirm" ? t("invite.confirmSubmit") : t("invite.submit")}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={submitCode} noValidate>
          <p className="mt-3 text-lg leading-relaxed text-navy-700">
            {t("contact.codeIntro", { email })}
          </p>
          <div className="mt-8">
            <label className={LABEL} htmlFor="invite-code">
              {t("contact.code")}
            </label>
            <input
              id="invite-code"
              className={`${FIELD} tracking-[0.4em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          {error && <p className="mt-6 text-lg text-red-700">{t(error)}</p>}
          <button className={BUTTON} disabled={busy} type="submit">
            {t("contact.codeSubmit")}
          </button>
        </form>
      )}

      {step === "waiting" && (
        <p className="mt-5 text-xl leading-8 text-navy-700">
          {t("invite.waitingBody", { title: journalTitle })}
        </p>
      )}

      {step === "in" && (
        <>
          <p className="mt-5 text-xl leading-8 text-navy-700">
            {t("invite.inBody", { title: journalTitle })}
          </p>
          <a
            className="mt-9 inline-flex min-h-12 items-center justify-center rounded-full bg-yellow-400 px-6 text-lg font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
            href={`/${username}`}
          >
            {t("err.goToJournal", { title: journalTitle })}
          </a>
        </>
      )}
    </main>
  );
}
