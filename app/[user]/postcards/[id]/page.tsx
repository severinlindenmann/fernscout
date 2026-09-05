import fs from "node:fs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NoticeShell from "@/components/NoticeShell";
import PageHeader from "@/components/PageHeader";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { balanceOf, creditsEnabled } from "@/lib/credits";
import { translateIn } from "@/lib/locales";
import type { TranslationKey } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { recipientsOf } from "@/lib/postcard/contacts";
import { readJpeg } from "@/lib/postcard/pdf";
import { backLayout, resolutionNote } from "@/lib/postcard/preview";
import { getOrder, isExpired, isPending } from "@/lib/postcard/orders";
import { LOCALE_LABEL } from "@/lib/i18n";
import { defaultLocaleFor, localesFor, requestLocale } from "@/lib/locales";
import { pickLocale } from "@/lib/contacts/locale";
import { formatDigestDate } from "@/lib/digest/content";
import { orderPhotoFile } from "@/lib/postcard/send";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The page the whole feature exists for — B434.
 *
 * An agent composes a set of postcards and hands over this URL. Here, and only
 * here, a person sees what is about to happen: the photograph, the words on the
 * back, who each card is going to, what it costs, what they have left — and one
 * button. Nothing before this page spends anything, and nothing except this
 * page's button can.
 *
 * ## Why the addresses are half hidden
 *
 * The list shows a name and a town. The street is behind a `<details>` the
 * owner opens deliberately. They are entitled to it — they are posting to it —
 * but this page is opened on a phone, at a table, with other people at the
 * table, and "confirm these are the right four people" does not need four home
 * addresses on screen to answer. The same reasoning that keeps addresses out of
 * the agent's reach entirely applies more weakly here, so the answer is weaker
 * rather than absent.
 *
 * ## Why a signed-out visitor is told to sign in rather than 404'd
 *
 * The same reason `/[user]/contacts` does it: the owner arrives from a link in
 * a conversation, on a phone whose session expired, and a dead end teaches them
 * nothing. The order itself is still only ever looked up scoped to the owner,
 * so an id belonging to somebody else is a 404 whoever is asking.
 */

/** Every outcome the two form routes can redirect back with, as a key rather
 * than a sentence — B461. The page used to hold English here and on every
 * label below, so a journal set to German met an English page. */
const RESULTS: Record<string, TranslationKey> = {
  sent: "postcard.result.sent",
  saved: "postcard.result.saved",
  forbidden: "postcard.result.forbidden",
  empty_text: "postcard.result.emptyText",
  already_sent: "postcard.result.alreadySent",
  expired: "postcard.result.expired",
  no_recipients: "postcard.result.noRecipients",
  no_credits: "postcard.result.noCredits",
  photo_missing: "postcard.result.photoMissing",
  postcards_off: "postcard.result.off",
  contacts_off: "postcard.result.off",
  provider_unavailable: "postcard.result.off",
  unknown_order: "postcard.result.unknown",
};

export default async function PostcardOrderPage({
  params,
  searchParams,
}: PageProps<"/[user]/postcards/[id]">) {
  const { user: username, id } = await params;
  const query = await searchParams;
  const result = query.result;
  // B466. The second step, and it is a query parameter rather than a dialog
  // on purpose: the whole flow is form posts so that it works on a phone with
  // a bad connection and no JavaScript, and a JS-only confirmation would leave
  // that path sending on the first click — the exact case this guards.
  const confirming = query.confirm === "1";

  const user = getUser(username);
  if (!user || !isEnabled("postcards", username)) notFound();

  // **The reader's chosen language, not the journal's** — B465. This page read
  // `pickLocale(user.defaultLocale)` and therefore stayed English for an owner
  // who had picked German in the switcher, because the example journal's own
  // default is English. `/[user]/me` draws the same line and names it
  // `uiLocale`: `requestLocale()` is the person looking at the screen,
  // `pickLocale(...)` is a fact about somebody else — a contact's own language.
  // The two are not interchangeable and this page had conflated them.
  const locale = pickLocale(await requestLocale());
  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translateIn(locale, key, vars);

  if (!(await isOwner(username))) {
    return (
      <NoticeShell
        lang={locale}
        title={translateIn(locale, "err.notSignedInTitle")}
        body={t("postcard.page.signInBody")}
        actions={[
          {
            href: `/${username}`,
            label: translateIn(locale, "err.goToJournal", { title: user.title }),
          },
        ]}
      />
    );
  }

  const order = await getOrder(username, id);
  if (!order) notFound();

  const people = await recipientsOf(username, order.payload.recipients);
  const lost = order.payload.recipients.filter((c) => !people.has(c)).length;
  const live = order.payload.recipients.filter((c) => people.has(c));
  const cost = order.payload.creditsEach * live.length;
  const balance = creditsEnabled() ? await balanceOf(username) : null;
  const expired = isExpired(order);
  const sendable = isPending(order) && !expired && live.length > 0;
  const short = balance !== null && balance < cost;

  const photoFile = orderPhotoFile(order);
  const photo = photoFile ? dimensionsOf(photoFile) : null;
  const resolution = photo ? resolutionNote(photo.width, photo.height) : null;
  const back = backLayout();
  // B452. The card's own language, and the journals's — so the picker offers
  // what this journal actually writes in rather than every locale that exists.
  const cardLocale = order.payload.locale || defaultLocaleFor(username);
  const offered = localesFor(username);
  const label = (code: string | null) =>
    code ? (LOCALE_LABEL[code] ?? code.toUpperCase()) : "";
  // Somebody writing to a German reader in English is often doing it on
  // purpose, so this is a note and never a refusal.
  const mismatches = live.filter((id) => {
    const other = people.get(id)!.locale;
    return other && other !== cardLocale;
  });
  const mismatched = mismatches.length;
  const firstMismatch = mismatches[0];

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold">{t("postcard.page.title")}</h1>
        <p className="mt-1 text-sm opacity-70">
          {t("postcard.page.intro", { day: order.payload.day })}
        </p>

        {typeof result === "string" && RESULTS[result] ? (
          <p
            className="mt-4 rounded border px-3 py-2 text-sm"
            role="status"
            data-testid="send-result"
          >
            {t(RESULTS[result])}
          </p>
        ) : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <figure>
            <div className="relative overflow-hidden rounded" style={{ aspectRatio: back.aspect }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the print
                  geometry is in millimetres and the point of this preview is
                  that the frame is exactly the card; next/image would impose
                  its own box on it. */}
              <img
                src={mediaUrl(order.payload.trip, order.payload.photo)}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <figcaption className="mt-1 text-xs opacity-70">
              {t("postcard.page.front")}
            </figcaption>
          </figure>

          <figure>
            {/* The container query container is *this* element — the card —
                and not the paragraph inside it. B451: `containerType` was on
                the `<p>`, so every `cqw` resolved against the message column's
                own width and the type came out at roughly twice its real size,
                five words to a card. */}
            <div
              className="relative overflow-hidden rounded border bg-white text-black"
              style={{ aspectRatio: back.aspect, containerType: "inline-size" }}
            >
              <p
                className="absolute overflow-hidden whitespace-pre-wrap"
                style={{
                  ...back.message,
                  fontSize: back.font.message,
                  lineHeight: back.font.leading,
                }}
              >
                {order.payload.message}
              </p>
              <p
                className="absolute text-black/50"
                style={{
                  left: back.message.left,
                  bottom: "6%",
                  fontSize: back.font.signature,
                }}
              >
                {order.payload.from}
              </p>
              <span
                className="absolute w-px bg-black/20"
                style={{ left: back.dividerLeft, top: "8%", height: "84%" }}
              />
              <span className="absolute rounded-sm border border-black/20" style={back.stamp} />
              {/* The address, drawn where the sorting machine reads it. An
                  empty dotted box proved the half of the card that does not
                  get it delivered. */}
              <div
                className="absolute"
                style={{
                  ...back.address,
                  fontSize: back.font.address,
                  lineHeight: back.font.addressLeading,
                }}
              >
                {live[0] ? (
                  <>
                    <span className="font-semibold">{people.get(live[0])!.to.name}</span>
                    <br />
                    {people.get(live[0])!.to.line1}
                    <br />
                    {people.get(live[0])!.to.postcode} {people.get(live[0])!.to.city}
                  </>
                ) : null}
              </div>
            </div>
            <figcaption className="mt-1 text-xs opacity-70">
              {live.length > 1
                ? t("postcard.page.backFirstOf", { count: String(live.length) })
                : t("postcard.page.back")}
            </figcaption>
          </figure>
        </section>

        {isPending(order) && !expired ? (
          <form
            method="post"
            action={`/${username}/postcards/${id}/message`}
            className="mt-6 rounded border px-4 py-3"
          >
            <label className="block text-sm font-semibold">
              {t("postcard.page.messageLabel")}
              <textarea
                name="message"
                rows={4}
                maxLength={600}
                defaultValue={order.payload.message}
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm font-normal"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="text-sm font-semibold">
                {t("postcard.page.signed")}
                <input
                  name="from"
                  defaultValue={order.payload.from}
                  className="mt-1 block rounded border px-2 py-1.5 text-sm font-normal"
                />
              </label>
              <label className="text-sm font-semibold">
                {t("postcard.page.writtenIn")}
                <select
                  name="locale"
                  defaultValue={cardLocale}
                  className="mt-1 block rounded border px-2 py-1.5 text-sm font-normal"
                >
                  {offered.map((code) => (
                    <option key={code} value={code}>
                      {label(code)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="submit" className="mt-3 rounded border px-3 py-1.5 text-sm font-medium">
              {t("postcard.page.save")}
            </button>
            {/* B461. Said once, next to the language picker, because "written
                in Deutsch" invites exactly one question — does a German reader
                get a German card? — and the answer is no. Nothing translates
                anything; everybody gets these words. */}
            <p className="mt-2 text-xs opacity-70">{t("postcard.page.sameCard")}</p>
            <p className="mt-1 text-xs opacity-70">{t("postcard.page.fixed")}</p>
          </form>
        ) : null}

        {mismatched > 0 ? (
          <p className="mt-4 rounded border px-3 py-2 text-sm">
            {mismatched === 1 && firstMismatch
              ? t("postcard.page.mismatchOne", {
                  name: people.get(firstMismatch)!.to.name,
                  theirs: label(people.get(firstMismatch)!.locale),
                  card: label(cardLocale),
                })
              : t("postcard.page.mismatchMany", {
                  count: String(mismatched),
                  card: label(cardLocale),
                })}
          </p>
        ) : null}

        {resolution && !resolution.ok ? (
          <p className="mt-4 rounded border px-3 py-2 text-sm">
            {t("postcard.page.lowRes", { dpi: String(resolution.dpi) })}
          </p>
        ) : null}

        <section className="mt-8">
          <h2 className="text-lg font-semibold">
            {live.length === 1
              ? t("postcard.page.goingOne")
              : t("postcard.page.goingMany", { count: String(live.length) })}
          </h2>
          {lost > 0 ? (
            <p className="mt-1 text-sm">
              {t("postcard.page.lost", { count: String(lost) })}
            </p>
          ) : null}
          <ul className="mt-2 space-y-1 text-sm">
            {live.map((contactId) => {
              const { to, locale } = people.get(contactId)!;
              return (
                <li key={contactId}>
                  <details>
                    <summary className="cursor-pointer">
                      {to.name} — {to.city}
                      {to.country ? `, ${to.country}` : ""}
                      {/* B452: the language this journal writes to them in. It
                          is how an owner notices a German reader being sent an
                          English card, which a postcard gives them no other
                          way to find out. */}
                      {locale && locale !== cardLocale ? (
                        <span className="opacity-60">
                          {" · "}
                          {t("postcard.page.reads", { language: label(locale) })}
                        </span>
                      ) : null}
                    </summary>
                    <address className="mt-1 pl-4 text-xs not-italic opacity-80">
                      {to.line1}
                      {to.line2 ? (
                        <>
                          <br />
                          {to.line2}
                        </>
                      ) : null}
                      <br />
                      {to.postcode} {to.city}
                    </address>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-8 rounded border px-4 py-3">
          <p className="text-sm">
            {t("postcard.page.cost", {
              each: String(order.payload.creditsEach),
              count: String(live.length),
              total: String(cost),
            })}
            {balance !== null ? (
              <>
                {" — "}
                {t("postcard.page.balance", { balance: String(balance) })}
              </>
            ) : null}
          </p>
          {short ? (
            <p className="mt-2 text-sm">
              {t("postcard.page.short", {
                missing: String(cost - (balance ?? 0)),
                date: formatDigestDate(locale, order.payload.expiresAt.slice(0, 10)),
              })}{" "}
              <a className="underline" href={`/${username}/me`}>
                {t("postcard.page.buy")}
              </a>
            </p>
          ) : null}

          {!isPending(order) ? (
            <p className="mt-2 text-sm">{t("postcard.page.alreadySent")}</p>
          ) : expired ? (
            <p className="mt-2 text-sm">
              {t("postcard.page.expiredOn", {
                date: formatDigestDate(locale, order.payload.expiresAt.slice(0, 10)),
              })}
            </p>
          ) : (
            confirming && sendable && !short ? (
              <div className="mt-3 rounded-lg border-2 border-navy-900 bg-cream-100 px-4 py-3">
                <p className="font-semibold">{t("postcard.confirm.heading")}</p>
                <p className="mt-1 text-sm">
                  {live.length === 1
                    ? t("postcard.confirm.bodyOne", { name: people.get(live[0])!.to.name })
                    : t("postcard.confirm.bodyMany", { count: String(live.length) })}
                </p>
                <p className="mt-1 text-sm">
                  {t("postcard.confirm.cost", {
                    total: String(cost),
                    rest: String((balance ?? cost) - cost),
                  })}
                </p>
                <p className="mt-1 text-sm font-medium">{t("postcard.confirm.undone")}</p>
                <form
                  method="post"
                  action={`/${username}/postcards/${id}/send`}
                  className="mt-3 flex flex-wrap items-center gap-3"
                >
                  <button
                    type="submit"
                    // The weight is CSS only — a press that visibly moves, and
                    // a ring while it is held. A spinner would need
                    // JavaScript, and this button's whole design is that it
                    // does not.
                    className="min-h-11 rounded-full bg-navy-900 px-5 text-sm font-semibold text-white shadow-md transition-all duration-150 hover:bg-navy-700 hover:shadow-lg focus-visible:ring-4 focus-visible:ring-yellow-400 active:translate-y-px active:shadow-sm motion-safe:animate-[pulse_2.5s_ease-in-out_infinite]"
                  >
                    {live.length === 1
                      ? t("postcard.confirm.yesOne")
                      : t("postcard.confirm.yesMany")}
                  </button>
                  <a
                    className="text-sm underline"
                    href={`/${username}/postcards/${id}`}
                  >
                    {t("postcard.confirm.back")}
                  </a>
                </form>
              </div>
            ) : (
              <div className="mt-3">
                {/* A link, not a submit: the first press only *asks*. */}
                <a
                  href={
                    sendable && !short ? `/${username}/postcards/${id}?confirm=1` : undefined
                  }
                  aria-disabled={!sendable || short}
                  className={`inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold transition-colors ${
                    sendable && !short
                      ? "bg-navy-900 text-white hover:bg-navy-700"
                      : "pointer-events-none bg-navy-900/40 text-white"
                  }`}
                >
                  {live.length === 1
                    ? t("postcard.page.sendOne", { total: String(cost) })
                    : t("postcard.page.sendMany", {
                        count: String(live.length),
                        total: String(cost),
                      })}
                </a>
                <p className="mt-2 text-xs opacity-70">{t("postcard.page.sendWarning")}</p>
              </div>
            )
          )}
        </section>
      </main>
    </div>
  );
}

function dimensionsOf(file: string): { width: number; height: number } | null {
  try {
    const image = readJpeg(new Uint8Array(fs.readFileSync(file)));
    return { width: image.width, height: image.height };
  } catch {
    // Not a JPEG, or unreadable. The resolution note is advice, not a gate —
    // `renderPostcard` still decides what it can actually embed.
    return null;
  }
}
