import fs from "node:fs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NoticeShell from "@/components/NoticeShell";
import PageHeader from "@/components/PageHeader";
import { isEnabled } from "@/lib/capabilities";
import { pickLocale } from "@/lib/contacts/locale";
import { isOwner } from "@/lib/contacts/session";
import { balanceOf, creditsEnabled } from "@/lib/credits";
import { translateIn } from "@/lib/locales";
import { mediaUrl } from "@/lib/media";
import { recipientsOf } from "@/lib/postcard/contacts";
import { readJpeg } from "@/lib/postcard/pdf";
import { backLayout, resolutionNote } from "@/lib/postcard/preview";
import { getOrder, isExpired, isPending } from "@/lib/postcard/orders";
import { LOCALE_LABEL } from "@/lib/i18n";
import { localesFor } from "@/lib/locales";
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

const RESULTS: Record<string, string> = {
  sent: "Sent. The cards have gone to the printer.",
  forbidden: "You are not signed in as the owner of this journal, so nothing was sent.",
  already_sent:
    "This order has already been sent. Nothing was sent again, and nothing charged.",
  expired: "This order is more than a week old, so it can no longer be sent. Ask for a new one.",
  no_recipients:
    "Nobody on this order can be posted to any more — they withdrew their address or their " +
    "consent since it was made. Nothing was sent and nothing charged.",
  no_credits: "There are not enough credits for this order. Nothing was sent and nothing charged.",
  photo_missing: "The photograph on this order is no longer in the trip. Nothing was sent.",
  postcards_off: "Postcards are switched off for this journal.",
  contacts_off: "Contacts are switched off for this journal.",
  unknown_order: "There is no such order.",
  saved: "Saved. Nothing has been printed or charged.",
  empty_text: "A card needs a message and a signature. Nothing was changed.",
  provider_unavailable: "No print provider is configured, so nothing was sent.",
};

export default async function PostcardOrderPage({
  params,
  searchParams,
}: PageProps<"/[user]/postcards/[id]">) {
  const { user: username, id } = await params;
  const result = (await searchParams).result;

  const user = getUser(username);
  if (!user || !isEnabled("postcards", username)) notFound();

  const locale = pickLocale(user.defaultLocale);

  if (!(await isOwner(username))) {
    return (
      <NoticeShell
        lang={locale}
        title={translateIn(locale, "err.notSignedInTitle")}
        body="Sign in as the owner of this journal to see the postcards waiting to be sent."
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
  const cardLocale = order.payload.locale || localesFor(username)[0];
  const offered = localesFor(username);
  const label = (code: string | null) =>
    code ? (LOCALE_LABEL[code] ?? code.toUpperCase()) : null;
  // Somebody writing to a German reader in English is often doing it on
  // purpose, so this is a note and never a refusal.
  const mismatched = live.filter((id) => {
    const other = people.get(id)!.locale;
    return other && other !== cardLocale;
  }).length;

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Postcards, ready to send</h1>
        <p className="mt-1 text-sm opacity-70">
          From {order.payload.day}. Nothing has been printed or charged yet.
        </p>

        {typeof result === "string" && RESULTS[result] ? (
          <p
            className="mt-4 rounded border px-3 py-2 text-sm"
            role="status"
            data-testid="send-result"
          >
            {RESULTS[result]}
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
            <figcaption className="mt-1 text-xs opacity-70">The front</figcaption>
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
              The back, at print size
              {live.length > 1 ? ` — addressed to the first of ${live.length}` : ""}
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
              What it says
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
                Signed
                <input
                  name="from"
                  defaultValue={order.payload.from}
                  className="mt-1 block rounded border px-2 py-1.5 text-sm font-normal"
                />
              </label>
              <label className="text-sm font-semibold">
                Written in
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
              Save the words
            </button>
            <p className="mt-2 text-xs opacity-70">
              The photograph and the people are fixed — changing those means a new order.
            </p>
          </form>
        ) : null}

        {mismatched > 0 ? (
          <p className="mt-4 rounded border px-3 py-2 text-sm">
            This card is written in {label(cardLocale)}, and{" "}
            {mismatched === 1 ? "one person on it reads" : `${mismatched} people on it read`}{" "}
            another language. That may be exactly what you meant — nothing is translated either
            way.
          </p>
        ) : null}

        {resolution && !resolution.ok ? (
          <p className="mt-4 rounded border px-3 py-2 text-sm">
            This photograph prints at about {resolution.dpi} dpi, below the 300 dpi a card wants —
            it will look soft on paper. A larger original would print better.
          </p>
        ) : null}

        <section className="mt-8">
          <h2 className="text-lg font-semibold">
            Going to {live.length} {live.length === 1 ? "person" : "people"}
          </h2>
          {lost > 0 ? (
            <p className="mt-1 text-sm">
              {lost} of the people on this order can no longer be posted to — they withdrew their
              address or their consent since it was made. They are not counted or charged for.
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
                      {locale ? (
                        <span className="opacity-60"> · reads {label(locale)}</span>
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
            {order.payload.creditsEach} credits each × {live.length} ={" "}
            <strong>{cost} credits</strong>
            {balance !== null ? <> — you have {balance}.</> : null}
          </p>
          {short ? (
            <p className="mt-2 text-sm">
              That is {cost - (balance ?? 0)} short.{" "}
              <a className="underline" href={`/${username}/me`}>
                Buy credits
              </a>{" "}
              and come back to this page; the order keeps until{" "}
              {new Date(order.payload.expiresAt).toLocaleDateString()}.
            </p>
          ) : null}

          {!isPending(order) ? (
            <p className="mt-2 text-sm">These cards have already been sent.</p>
          ) : expired ? (
            <p className="mt-2 text-sm">
              This order expired on {new Date(order.payload.expiresAt).toLocaleDateString()}. Ask
              for a new one.
            </p>
          ) : (
            <form method="post" action={`/${username}/postcards/${id}/send`} className="mt-3">
              <button
                type="submit"
                disabled={!sendable || short}
                className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Send {live.length} {live.length === 1 ? "postcard" : "postcards"} for {cost} credits
              </button>
              <p className="mt-2 text-xs opacity-70">
                This prints and posts real cards, and spends the credits. It cannot be undone.
              </p>
            </form>
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
