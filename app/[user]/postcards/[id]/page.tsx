import fs from "node:fs";
import type { Metadata } from "next";
import Link from "next/link";
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
import { travellerPartyFor } from "@/lib/postcard/entry";
import { travellersSvg } from "@/lib/photobook/travellers";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { LOCALE_LABEL } from "@/lib/i18n";
import { defaultLocaleFor, localesFor, requestLocale } from "@/lib/locales";
import { pickLocale } from "@/lib/contacts/locale";
import { formatDigestDate } from "@/lib/digest/content";
import { orderPhotoFile } from "@/lib/postcard/send";
import { getTrip } from "@/lib/trips";
import { getUser } from "@/lib/users";
import PostcardCropper from "@/components/PostcardCropper";
import PostcardBack from "./PostcardBack";

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
  provider_unavailable: "postcard.result.providerFailed",
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

  // B474. `payload.day` is a slug — a URL segment, not a name — and the page
  // was printing it at a reader ("Vom sierra-smoke"). The day has a title, and
  // a postcard is about a date, so both go in. Drafts included: an order can
  // be made from a day that is not on the site yet.
  const entry = getEntryBySlug(order.payload.trip, order.payload.day, AS_AUTHOR);
  const dayName = entry
    ? t("postcard.page.dayWithTitle", {
        title: entry.title,
        date: formatDigestDate(locale, entry.date),
      })
    : order.payload.day;

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

  // B628. The trip's own party — see `travellerPartyFor` for why a buddy has
  // no likeness of their own to fall back to. `showFigures` is what the
  // toggle actually controls; `hasParty` is whether there is anything for it
  // to switch on in the first place.
  const trip = getTrip(order.payload.trip);
  const party = trip ? travellerPartyFor(trip) : [];
  const hasParty = party.length > 0;
  const showFigures = order.payload.figures !== false && hasParty;

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        {/* B474. Both of these were written once and rendered whatever had
            happened, so an order already at the printer was headed "ready to
            send" above a line promising nothing had been printed or charged —
            directly above the banner saying it had. */}
        {/* Three states, not two. `failed` is not `draft` and so fell to the
            "sent" side of a boolean, which headed an order whose every card the
            printer had refused "Postcards, sent" over "they are with the
            printer" — the same B474 fault one status further along. */}
        <h1 className="font-display text-2xl font-semibold text-navy-900">
          {isPending(order)
            ? t("postcard.page.title")
            : order.status === "failed"
              ? t("postcard.page.titleFailed")
              : t("postcard.page.titleSent")}
        </h1>
        <p className="mt-1 text-sm text-navy-600">
          {isPending(order)
            ? t("postcard.page.intro", { day: dayName })
            : order.status === "failed"
              ? t("postcard.page.introFailed", { day: dayName })
              : t("postcard.page.introSent", {
                  day: dayName,
                  when: formatDigestDate(locale, order.updatedAt.slice(0, 10)),
                })}
        </p>


        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <figure>
            <PostcardCropper
              username={username}
              id={id}
              src={mediaUrl(order.payload.trip, order.payload.photo)}
              aspect={back.aspect}
              initial={order.payload.crop ?? { x: 0.5, y: 0.5 }}
              editable={isPending(order) && !expired}
              hint={t("postcard.page.cropHint")}
              savingLabel={t("postcard.page.cropSaving")}
              resetLabel={t("postcard.page.cropReset")}
              zoomLabel={t("postcard.page.cropZoom")}
            />
            <figcaption className="mt-1 text-xs text-navy-600">
              {t("postcard.page.front")}
            </figcaption>
          </figure>

          <PostcardBack
            username={username}
            id={id}
            layout={back}
            initial={{
              message: order.payload.message,
              from: order.payload.from,
              locale: cardLocale,
              figures: showFigures,
            }}
            locales={offered}
            localeLabel={Object.fromEntries(offered.map((code) => [code, label(code)]))}
            figuresSvg={hasParty ? travellersSvg(100, party) : null}
            address={
              live[0]
                ? {
                    name: people.get(live[0])!.to.name,
                    line1: people.get(live[0])!.to.line1,
                    postcode: people.get(live[0])!.to.postcode,
                    city: people.get(live[0])!.to.city,
                  }
                : null
            }
            editable={isPending(order) && !expired}
            strings={{
              messageLabel: t("postcard.page.messageLabel"),
              signed: t("postcard.page.signed"),
              writtenIn: t("postcard.page.writtenIn"),
              figuresLabel: t("postcard.page.figuresLabel"),
              save: t("postcard.page.save"),
              saving: t("postcard.page.saving"),
              saved: t("postcard.page.savedNow"),
              failed: t("postcard.page.saveFailed"),
              sameCard: t("postcard.page.sameCard"),
              fixed: t("postcard.page.fixed"),
              caption:
                live.length > 1
                  ? t("postcard.page.backFirstOf", { count: String(live.length) })
                  : t("postcard.page.back"),
            }}
          />
        </section>

        {/* B628 — the one thing left outside the form: a trip nobody has
            described has nothing to switch on, and saying so is the only
            useful thing this space can do. */}
        {isPending(order) && !expired && !hasParty ? (
          <p className="mt-4 text-xs text-navy-600">{t("postcard.page.figuresNone")}</p>
        ) : null}

        {mismatched > 0 && isPending(order) ? (
          <p className="mt-4 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
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

        {resolution && !resolution.ok && isPending(order) ? (
          <p className="mt-4 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
            {t("postcard.page.lowRes", { dpi: String(resolution.dpi) })}
          </p>
        ) : null}

        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold text-navy-900">
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

        {/* `id="send"` is the anchor every step of the send flow returns to —
            B850. All three of them are navigations, and a navigation with no
            fragment lands at the top of a long page: the `?confirm=1` link
            below (the *first* press, and the one that was actually being
            complained about), the "back" link out of the confirm panel, and the
            303 out of the send route. The reader presses a button in this box
            and has to end up looking at this box; anchoring the result banner
            alone fixed only the third of the three, and did it two lines under
            the `<h1>`, where scrolling to it and jumping to the top are the
            same movement. */}
        <section
          id="send"
          className="mt-8 scroll-mt-4 rounded-xl border-2 border-navy-900 bg-cream-100 p-4"
        >
          {/* The outcome belongs where the button was, not at the top of the
              page — B850, second attempt. The first put an `id` on this banner
              and pointed the redirect at it, which was correct and useless: the
              banner lived two lines under the `<h1>`, so scrolling to it and
              jumping to the top are the same movement. The reader pressed a
              button at the bottom of a long page and was shown a heading about
              the order instead of an answer about their press. Moving it into
              this box is the actual fix; the anchor now has somewhere worth
              going. */}
          {typeof result === "string" && RESULTS[result] ? (
            <p
              // `scroll-mt-4` keeps it off the very top edge once scrolled to.
              id="send-result"
              className="mb-3 scroll-mt-4 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900"
              role="status"
              data-testid="send-result"
            >
              {t(RESULTS[result])}
            </p>
          ) : null}
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
            confirming && sendable ? (
              <div className="mt-3 rounded-lg border border-navy-900 bg-white px-4 py-3">
                <p className="font-semibold">{t("postcard.confirm.heading")}</p>
                <p className="mt-1 text-sm">
                  {live.length === 1
                    ? t("postcard.confirm.bodyOne", { name: people.get(live[0])!.to.name })
                    : t("postcard.confirm.bodyMany", { count: String(live.length) })}
                </p>
                {/* Suppressed when the balance is short: "leaving you -3" is
                    not a sentence, and the shortfall line above already says
                    the number and where to buy — B606. */}
                {!short && (
                  <p className="mt-1 text-sm">
                    {t("postcard.confirm.cost", {
                      total: String(cost),
                      rest: String((balance ?? cost) - cost),
                    })}
                  </p>
                )}
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
                  <Link
                    className="text-sm underline"
                    href={`/${username}/postcards/${id}#send`}
                  >
                    {t("postcard.confirm.back")}
                  </Link>
                </form>
              </div>
            ) : (
              <div className="mt-3">
                {/* A link, not a submit: the first press only *asks*. */}
                {/* `Link`, not `<a>` — B892. Both presses in this flow were
                    full document loads: the page flashed, the reader was put
                    back at the top, and the whole thing felt like it had gone
                    wrong even when it had not. A soft navigation keeps
                    `?confirm=1` in the URL, so B466's reasoning is untouched —
                    with JavaScript off this is still an ordinary link to a
                    server-rendered second step, and nothing can send on the
                    first click. */}
                <Link
                  href={
                    sendable ? `/${username}/postcards/${id}?confirm=1#send` : ""
                  }
                  aria-disabled={!sendable}
                  className={`inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold transition-colors ${
                    sendable
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
                </Link>
                <p className="mt-2 text-xs text-navy-600">{t("postcard.page.sendWarning")}</p>
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
