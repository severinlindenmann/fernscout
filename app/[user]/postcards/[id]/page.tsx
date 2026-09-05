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
import { addressesFor } from "@/lib/postcard/contacts";
import { readJpeg } from "@/lib/postcard/pdf";
import { backLayout, resolutionNote } from "@/lib/postcard/preview";
import { getOrder, isExpired, isPending } from "@/lib/postcard/orders";
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

  const addresses = await addressesFor(username, order.payload.recipients);
  const lost = order.payload.recipients.filter((c) => !addresses.has(c)).length;
  const live = order.payload.recipients.filter((c) => addresses.has(c));
  const cost = order.payload.creditsEach * live.length;
  const balance = creditsEnabled() ? await balanceOf(username) : null;
  const expired = isExpired(order);
  const sendable = isPending(order) && !expired && live.length > 0;
  const short = balance !== null && balance < cost;

  const photoFile = orderPhotoFile(order);
  const photo = photoFile ? dimensionsOf(photoFile) : null;
  const resolution = photo ? resolutionNote(photo.width, photo.height) : null;
  const back = backLayout();

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
            <div
              className="relative overflow-hidden rounded border bg-white text-black"
              style={{ aspectRatio: back.aspect }}
            >
              <p
                className="absolute overflow-hidden text-[2.4cqw] leading-snug whitespace-pre-wrap"
                style={{ ...back.message, containerType: "size" }}
              >
                {order.payload.message}
                {"\n\n"}
                {order.payload.from}
              </p>
              <span
                className="absolute w-px bg-black/20"
                style={{ left: back.dividerLeft, top: "8%", height: "84%" }}
              />
              <span className="absolute rounded-sm border border-black/20" style={back.stamp} />
              <div
                className="absolute border-b border-dotted border-black/20 text-[2.2cqw]"
                style={back.address}
                aria-hidden
              />
            </div>
            <figcaption className="mt-1 text-xs opacity-70">
              The back — message, stamp and the address block where the sorting machine reads it
            </figcaption>
          </figure>
        </section>

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
              const to = addresses.get(contactId)!;
              return (
                <li key={contactId}>
                  <details>
                    <summary className="cursor-pointer">
                      {to.name} — {to.city}
                      {to.country ? `, ${to.country}` : ""}
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
