import fs from "node:fs";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import NoticeShell from "@/components/NoticeShell";
import PageHeader from "@/components/PageHeader";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { balanceOf, creditsEnabled } from "@/lib/credits";
import { formatCredits } from "@/lib/credits/format";
import { translateIn } from "@/lib/locales";
import type { TranslationKey } from "@/lib/i18n";
import { mediaUrl } from "@/lib/media";
import { addressesFor, postcardCandidates, recipientsOf } from "@/lib/postcard/contacts";
import { printerAddressLines } from "@/lib/postcard/providers";
import { readJpeg } from "@/lib/postcard/pdf";
import { backLayout, resolutionNote } from "@/lib/postcard/preview";
import { messageFit } from "@/lib/postcard/render";
import { getOrder, isExpired, isPending, refreshProviderStatuses } from "@/lib/postcard/orders";
import { postcardOrderView } from "@/lib/order/view";
import OrderDocket from "@/components/order/OrderDocket";
import { travellerPartyFor } from "@/lib/postcard/entry";
import { travellersSvg } from "@/lib/photobook/travellers";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { LOCALE_LABEL } from "@/lib/i18n";
import { defaultLocaleFor, localesFor, requestLocale } from "@/lib/locales";
import { pickLocale } from "@/lib/contacts/locale";
import { formatDigestDate } from "@/lib/digest/content";
import { orderPrintPhoto } from "@/lib/postcard/send";
import { getTrip } from "@/lib/trips";
import { getUser } from "@/lib/users";
import PostcardCropper from "@/components/PostcardCropper";
import PostcardBack from "./PostcardBack";
import PostcardSend from "./PostcardSend";
import PostcardSteps from "./PostcardSteps";
import PostcardPeople from "./PostcardPeople";

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
            label: translateIn(locale, "err.goToJournal", {
              title: user.title,
            }),
          },
        ]}
      />
    );
  }

  let order = await getOrder(username, id);
  if (!order) notFound();

  // B1548 — Stannp has no push for `printing`/`dispatched`, only for
  // cancellation, so a card already at the printer is the only case worth
  // asking about here. Best-effort: `refreshProviderStatuses` never throws.
  if (order.status === "built" || order.status === "failed") {
    order = await refreshProviderStatuses(order);
  }

  const people = await recipientsOf(username, order.payload.recipients);
  // Everyone who could be on this card, not only who is — B1005's send step
  // offers the list rather than reciting it. Same source the composer sheet
  // reads, so "who may be posted to" is decided in one place.
  const candidates = await postcardCandidates(username);
  // Every candidate's envelope, not only the ones already on the order —
  // B1018. Since B1005 the list is editable, so "already named on the order"
  // stopped meaning "who you are posting to": the person you have just ticked
  // is exactly the one whose address you want to check. Still the owner's own
  // page, still only rendered for a ticked recipient, and still behind the
  // disclosure B434 put it behind.
  const envelopes = await addressesFor(
    username,
    candidates.map((candidate) => candidate.contactId),
  );
  const lost = order.payload.recipients.filter((c) => !people.has(c)).length;
  const live = order.payload.recipients.filter((c) => people.has(c));
  const cost = order.payload.creditsEach * live.length;
  const balance = creditsEnabled() ? await balanceOf(username) : null;
  const expired = isExpired(order);
  const sendable = isPending(order) && !expired && live.length > 0;
  /** Nothing left to compose: sent, refused, or a proposal that ran out —
   *  B1479. The stepper is for an order somebody can still change. */
  const settled = !isPending(order) || expired;
  const short = balance !== null && balance < cost;

  // B474. `payload.day` is a slug — a URL segment, not a name — and the page
  // was printing it at a reader ("Vom sierra-smoke"). The day has a title, and
  // a postcard is about a date, so both go in. Drafts included: an order can
  // be made from a day that is not on the site yet.
  // B1393 — a card from a photograph staged in the inbox belongs to no trip
  // and no day; `order.payload.trip` says which this is, and nothing below
  // reads `.day` as a slug unless it does.
  const entry =
    order.payload.trip && order.payload.day
      ? getEntryBySlug(order.payload.trip, order.payload.day, AS_AUTHOR)
      : null;
  const dayName = entry
    ? t("postcard.page.dayWithTitle", {
        title: entry.title,
        date: formatDigestDate(locale, entry.date),
      })
    : order.payload.day;

  // The copy that actually prints, and its size — B1010. `printSourceFor`
  // hands back the original's dimensions when the original is what will be
  // embedded, which is the whole point: measuring the derivative said 244 dpi
  // about a photograph that prints at about 660.
  const print = orderPrintPhoto(order);
  const photo = print ? (print.size ?? dimensionsOf(print.absolute)) : null;
  const resolution = photo ? resolutionNote(photo.width, photo.height) : null;
  // B1393 — a trip-less order's photograph is in the inbox and reachable by
  // no ordinary media URL (`lib/inbox.ts`), so the owner-only, cookie-gated
  // thumbnail route the files pane already uses is what this page asks for
  // instead. Wide enough for the crop control, not the original: this is a
  // preview, and `orderPrintPhoto` below is what the card is actually built
  // from.
  const photoSrc = order.payload.trip
    ? mediaUrl(order.payload.trip, order.payload.photo)
    : `/api/helper/${encodeURIComponent(username)}/inbox/${encodeURIComponent(order.payload.photo)}/thumbnail?w=1600`;
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
  const trip = order.payload.trip ? getTrip(order.payload.trip) : null;
  const party = trip ? travellerPartyFor(trip) : [];
  const hasParty = party.length > 0;
  const showFigures = order.payload.figures !== false && hasParty;

  // One order, in the same shape a photobook order takes — B1467.
  /** How much of the message the printer will set — B1511, and the only
   *  honest answer to "does it fit" while the preview is not to scale. */
  const fit = (() => {
    const { lines, maxLines } = messageFit(order.payload.message);
    return { over: lines - maxLines };
  })();

  const view = postcardOrderView({
    order,
    t,
    dayName,
    sentWhen: formatDigestDate(locale, order.updatedAt.slice(0, 10)),
    recipients: live.map((id) => {
      const to = people.get(id)!.to;
      return { name: to.name, town: [to.city, to.country].filter(Boolean).join(", ") };
    }),
  });

  return (
    <div className="min-h-screen">
      <PageHeader />
      {/* Wider from `lg` — B1005. The write step puts the card beside its
          form, and two columns inside 48rem is two narrow columns; the other
          two steps cap themselves at `max-w-2xl`, so nothing else stretches.
          They are capped and *not* centred — B1010: the heading, the step bar
          and the forward button all start at the left margin, and a panel
          floating in the middle of them made the button look like it belonged
          to something else. */}
      <main className="mx-auto w-full max-w-3xl px-4 py-8 lg:max-w-5xl">
        {/* B474. Both of these were written once and rendered whatever had
            happened, so an order already at the printer was headed "ready to
            send" above a line promising nothing had been printed or charged —
            directly above the banner saying it had. */}
        {/* Three states, not two. `failed` is not `draft` and so fell to the
            "sent" side of a boolean, which headed an order whose every card the
            printer had refused "Postcards, sent" over "they are with the
            printer" — the same B474 fault one status further along. */}
        {/* One vocabulary — B1467. The title, the intro and the state this
            order is in are decided in `postcardOrderView`, beside the
            photobook's, rather than by a three-way ladder written out here.
            B474 and the ticket after it are both faults of that ladder: an
            order already at the printer headed "ready to send", and a
            refused set headed "sent".

            **Only while it is pending** — the docket below carries its own
            head, and a settled order printed both: the same title, the same
            sentence and the same pill, twice, two hundred pixels apart. */}
        {/* A pending order's head belongs to the stepper — B1490. It has two
            titles (the opening card says how many are waiting, the steps say
            what the order is), and a head rendered here as well printed one
            of them twice. A settled order has no stepper and its head comes
            from the docket below. */}

        {/* Once it is settled there is nothing left to compose — B1479.
            A sent order used to render the stepper read-only: a crop slider
            that cannot crop, a message field that cannot be edited, three
            step buttons for steps that are over. What an order that has gone
            is, is a receipt, and that is the same element a photobook order
            lands on.

            `Look` and `Write` are untouched below, for as long as the order
            is still pending. Composing is not ordering. */}
        {settled ? (
          <div className="mt-6">
            <OrderDocket
              view={view}
              labels={{
                price: t("photobook.receipt.priceHeading"),
                total: t("photobook.receipt.total"),
                goingTo: t("photobook.print.toLabel"),
                files: t("photobook.downloadFile"),
                download: t("photobook.downloadFile"),
                noFiles: t("photobook.print.noFiles"),
              }}
              objectMedia={
                /* The photograph under this order's own crop — the same three
                   properties `PostcardCropper` sets, so the plate frames what
                   was printed rather than the whole picture. */
                <img
                  src={photoSrc}
                  alt={t("postcard.page.front")}
                  style={{
                    objectFit: "cover",
                    aspectRatio: String(back.aspect),
                    objectPosition: `${(order.payload.crop?.x ?? 0.5) * 100}% ${(order.payload.crop?.y ?? 0.5) * 100}%`,
                    transform:
                      (order.payload.crop?.zoom ?? 1) === 1
                        ? undefined
                        : `scale(${order.payload.crop?.zoom})`,
                    transformOrigin: `${(order.payload.crop?.x ?? 0.5) * 100}% ${(order.payload.crop?.y ?? 0.5) * 100}%`,
                  }}
                  className="block w-full bg-navy-50"
                />
              }
            />
          </div>
        ) : (
        <PostcardSteps
          opening={{
            eyebrow: t("postcard.title"),
            title: view.head.title,
            body: view.head.subtitle,
          }}
          start={typeof result === "string" || confirming ? "send" : "look"}
          settled={settled}
          labels={{
            look: t("postcard.step.look"),
            write: t("postcard.step.write"),
            send: t("postcard.step.send"),
          }}
          next={{
            look: t("postcard.step.nextLook"),
            write: t("postcard.step.nextWrite"),
          }}
          back={t("postcard.step.back")}
          /**
           * The `key` on each panel is not decoration — B1005.
           *
           * These elements are built here, on the server, and handed to a
           * client component as props. Crossing that boundary loses React's
           * "these children are static" marker, so on the client the panel's
           * children arrive as an array React feels entitled to validate — and
           * it then asks for a key on elements this page owns. One attribute
           * each, and the dev overlay is quiet. Nothing about the rendering
           * changes: a key outside an array is ignored.
           */
          lookPanel={
            <div key="look" className="max-w-2xl">
              <figure>
                {/* The label above the picture — B1510. Under it, it named
                    the photograph after it had been looked at; the Write
                    step's own card names itself before its contents and this
                    now reads the same way. */}
                <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wider text-navy-500">
                  {t("postcard.page.front")}
                </figcaption>
                <PostcardCropper
                  username={username}
                  id={id}
                  src={photoSrc}
                  aspect={back.aspect}
                  initial={order.payload.crop ?? { x: 0.5, y: 0.5 }}
                  editable={isPending(order) && !expired}
                  hint={t("postcard.page.cropHint")}
                  savingLabel={t("postcard.page.cropSaving")}
                  resetLabel={t("postcard.page.cropReset")}
                  zoomLabel={t("postcard.page.cropZoom")}
                />
              </figure>
              {/* Beside the photograph rather than four screens later — B1005.
                  It is advice about *this* picture, and it is only useful
                  while choosing another one is still cheap.

                  A plain line and not a yellow panel — B1010. Yellow is what
                  this product uses for something that stops a send; this stops
                  nothing, and it appeared on a page where somebody is about to
                  spend twenty credits. It also no longer carries the dpi
                  figure: a number a person cannot act on is not advice, and it
                  reads as a fault rather than as a suggestion. */}
              {resolution && !resolution.ok && isPending(order) ? (
                <p className="mt-3 text-sm text-navy-600">
                  {t("postcard.page.smallPhoto")}
                </p>
              ) : null}
            </div>
          }
          writePanel={
            <div key="write">
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
                localeLabel={Object.fromEntries(
                  offered.map((code) => [code, label(code)]),
                )}
                figuresSvg={hasParty ? travellersSvg(100, party) : null}
                // As the printer will set it, not as this product used to print
                // it — B982. The card that goes to Stannp now carries no address
                // at all, because Stannp lays down its own; what is worth showing
                // here is therefore theirs.
                address={
                  live[0] ? printerAddressLines(people.get(live[0])!.to) : null
                }
                editable={isPending(order) && !expired}
                strings={{
                  messageLabel: t("postcard.page.messageLabel"),
                  signed: t("postcard.page.signed"),
                  writtenIn: t("postcard.page.writtenIn"),
                  figuresLabel: t("postcard.page.figuresLabel"),
                  saving: t("postcard.page.saving"),
                  saved: t("postcard.page.savedNow"),
                  failed: t("postcard.page.saveFailed"),
                  sameCard: t("postcard.page.sameCard"),
                  printerAdds: t("postcard.page.printerAdds"),
                  // B1511. The preview is not to scale on a phone, so what
                  // fits is answered from the renderer rather than from the
                  // picture.
                  fit:
                    fit.over <= 0
                      ? t("postcard.page.fits")
                      : t(
                          fit.over === 1
                            ? "postcard.page.overflows.one"
                            : "postcard.page.overflows",
                          { count: String(fit.over) },
                        ),
                  fitOver: fit.over > 0,
                  caption:
                    live.length > 1
                      ? t("postcard.page.backFirstOf", {
                          count: String(live.length),
                        })
                      : t("postcard.page.back"),
                }}
              />

              {/* B628 — a trip nobody has described has nothing to switch on,
                  and saying so is the only useful thing this space can do. */}
              {isPending(order) && !expired && !hasParty ? (
                <p className="mt-4 text-xs text-navy-600">
                  {t("postcard.page.figuresNone")}
                </p>
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
            </div>
          }
          sendPanel={
            <div key="send" className="max-w-2xl">
              <PostcardPeople
                username={username}
                id={id}
                candidates={candidates.map((candidate) => ({
                  contactId: candidate.contactId,
                  name: candidate.name,
                  city: candidate.city,
                  country: candidate.country,
                  // Formatted here, on the server, because `t` cannot cross
                  // into a client component — B1005.
                  readsNote:
                    candidate.locale && candidate.locale !== cardLocale
                      ? t("postcard.page.reads", { language: label(candidate.locale) })
                      : null,
                  address: envelopes.has(candidate.contactId)
                    ? {
                        line1: envelopes.get(candidate.contactId)!.line1,
                        line2: envelopes.get(candidate.contactId)!.line2 ?? "",
                        postcode: envelopes.get(candidate.contactId)!.postcode,
                        city: envelopes.get(candidate.contactId)!.city,
                      }
                    : null,
                }))}
                chosen={live}
                editable={isPending(order) && !expired}
                strings={{
                  heading:
                    live.length === 1
                      ? t("postcard.page.goingOne")
                      : t("postcard.page.goingMany", {
                          count: String(live.length),
                        }),
                  save: t("postcard.people.save"),
                  saving: t("postcard.page.saving"),
                  saved: t("postcard.page.savedNow"),
                  failed: t("postcard.page.saveFailed"),
                  lost:
                    lost > 0
                      ? t("postcard.page.lost", { count: String(lost) })
                      : null,
                  none: t("postcard.noRecipients"),
                }}
              />

              <div className="mt-4">
                <PostcardSend
                  username={username}
                  id={id}
                  confirming={confirming}
                  sendable={sendable}
                  statusLine={
                    !isPending(order)
                      ? t("postcard.page.alreadySent")
                      : expired
                        ? t("postcard.page.expiredOn", {
                            date: formatDigestDate(
                              locale,
                              order.payload.expiresAt.slice(0, 10),
                            ),
                          })
                        : null
                  }
                  short={short}
                  initialResult={typeof result === "string" ? result : null}
                  results={Object.fromEntries(
                    Object.entries(RESULTS).map(([word, key]) => [
                      word,
                      t(key),
                    ]),
                  )}
                  ledger={view.ledger}
                  strings={{
                    priceHeading: t("photobook.receipt.priceHeading"),
                    priceTotal: t("photobook.receipt.total"),
                    balance:
                      balance !== null
                        ? t("postcard.page.balance", {
                            balance: formatCredits(balance),
                          })
                        : null,
                    short: short
                      ? t("postcard.page.short", {
                          missing: String(cost - (balance ?? 0)),
                          date: formatDigestDate(
                            locale,
                            order.payload.expiresAt.slice(0, 10),
                          ),
                        })
                      : null,
                    buy: t("postcard.page.buy"),
                    heading: t("postcard.confirm.heading"),
                    body:
                      live.length === 1 && live[0]
                        ? t("postcard.confirm.bodyOne", {
                            name: people.get(live[0])!.to.name,
                          })
                        : t("postcard.confirm.bodyMany", {
                            count: String(live.length),
                          }),
                    confirmCost: t("postcard.confirm.cost", {
                      total: String(cost),
                      rest: String((balance ?? cost) - cost),
                    }),
                    undone: t("postcard.confirm.undone"),
                    yes:
                      live.length === 1
                        ? t("postcard.confirm.yesOne")
                        : t("postcard.confirm.yesMany"),
                    sending: t("postcard.confirm.sending"),
                    back: t("postcard.confirm.back"),
                    send:
                      live.length === 1
                        ? t("postcard.page.sendOne", { total: String(cost) })
                        : t("postcard.page.sendMany", {
                            count: String(live.length),
                            total: String(cost),
                          }),
                  }}
                />
              </div>
            </div>
          }
        />
        )}
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
