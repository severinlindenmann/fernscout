"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "motion/react";
import BusyButton from "@/components/BusyButton";
import EnvelopeFly from "@/components/EnvelopeFly";
import { OrderLedgerCard } from "@/components/order/OrderDocket";
import type { OrderLedger } from "@/lib/order/ledger";

/**
 * The box the money leaves from — B982.
 *
 * Everything here was server-rendered, and every step of it was a document
 * load: the first press was a link to `?confirm=1`, the second was a form post
 * answered with a 303, and both threw the page away and drew it again. B850
 * spent two attempts making the reader land somewhere sensible after that
 * flash, which is the right fix for the wrong problem — the flash is the
 * problem. The one press in this product that spends credits and posts real
 * card looked exactly like a page that had gone wrong.
 *
 * So the two steps are state, the send is a `fetch` (see the route, which
 * answers the outcome word to a caller that asks for JSON), and the envelope
 * from `components/EnvelopeFly` flies off the button that was pressed — the
 * same drawing B753 made for the one other moment in this product where
 * something physically leaves the building. Then `router.refresh()` re-renders
 * the server half in place, so the heading says "Postcards, sent" and the back
 * goes read-only without a load.
 *
 * ## With JavaScript off, nothing here is load bearing
 *
 * The first press is a real `<Link>` to `?confirm=1` and the server still
 * renders the confirm step from that query — which is why `confirming` is a
 * prop rather than something this decides alone. The second is a real
 * `<form method="post" action=…>` whose submit handler simply does not exist.
 * B466's reasoning is untouched: the first press only ever *asks*, in both
 * worlds, and nothing can send on it.
 *
 * ## Why a failure leaves the order sendable
 *
 * Every refusal this can be given — not enough credits, nobody left to post
 * to, the printer refused — is a sentence about the order rather than about
 * the press, and the order is still there. So the box goes back to offering
 * the button with the refusal above it, and only `sent` settles.
 */
export default function PostcardSend({
  ledger,
  username,
  id,
  confirming,
  sendable,
  statusLine,
  short,
  results,
  initialResult,
  strings,
}: {
  username: string;
  id: string;
  /** `?confirm=1` — the no-JavaScript first press, and this component's own
   * starting step so the two agree. */
  confirming: boolean;
  sendable: boolean;
  /** What to say instead of a button, when there is nothing left to press:
   * already sent, or expired on a date. Null while the order is live.
   *
   * It is a prop rather than the page's own paragraph so that this box keeps
   * rendering after a successful send — `router.refresh()` turns a pending
   * order into a sent one, and a box that were swapped out for a different
   * one at that moment would take its own "Sent." with it, which is the jump
   * again in miniature. */
  statusLine: string | null;
  short: boolean;
  /** Every outcome word, already translated — the server holds the map. */
  results: Record<string, string>;
  /** The word a no-JavaScript redirect came back with, if any. */
  initialResult: string | null;
  /** What it costs, already priced by the page. */
  ledger: OrderLedger;
  strings: {
    priceHeading: string;
    priceTotal: string;
    balance: string | null;
    short: string | null;
    buy: string;
    heading: string;
    body: string;
    confirmCost: string;
    undone: string;
    yes: string;
    sending: string;
    back: string;
    send: string;
    warning: string;
  };
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState<"idle" | "confirm">(
    confirming ? "confirm" : "idle",
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(initialResult);
  // The envelope, exactly as `IdentitySignIn` mounts it: against the box
  // rather than the button, because the button is unmounted the moment the
  // send settles and a flight is longer than a fast round trip. `flightId`
  // gives each press its own key.
  const boxRef = useRef<HTMLElement | null>(null);
  const sendRef = useRef<HTMLButtonElement | null>(null);
  const [flying, setFlying] = useState(false);
  const [flightId, setFlightId] = useState(0);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

  const sent = result === "sent";

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);

    // Starts on the press and finishes on its own clock, so a slow refusal is
    // never something the envelope is still flying over — B753's rule, and it
    // matters more here, where the refusal may be about money.
    if (!reduceMotion) {
      const box = boxRef.current?.getBoundingClientRect();
      const button = sendRef.current?.getBoundingClientRect();
      if (box && button) {
        setOrigin({
          x: button.x - box.x + button.width / 2,
          y: button.y - box.y + button.height / 2,
        });
        setFlightId((n) => n + 1);
        setFlying(true);
      }
    }

    const response = await fetch(`/${username}/postcards/${id}/send`, {
      method: "POST",
      headers: { accept: "application/json" },
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      result?: string;
    } | null;

    setBusy(false);
    // No answer at all is the one case with no word of its own: the request
    // never arrived, so nothing was printed and nothing charged, and the
    // honest thing is to say the send did not happen rather than to guess.
    const word = body?.result ?? "provider_unavailable";
    setResult(word);
    if (word === "sent") {
      // The rest of the page — the heading, the intro, the back going
      // read-only — is server-rendered from the order, and it is now stale.
      router.refresh();
    } else {
      setStep("idle");
    }
  }

  return (
    <section
      id="send"
      ref={boxRef}
      className="relative mt-8 scroll-mt-4 rounded-xl border-2 border-navy-900 bg-cream-100 p-4"
    >
      {flying && origin ? (
        <EnvelopeFly
          key={flightId}
          origin={origin}
          onDone={() => setFlying(false)}
        />
      ) : null}

      {/* No entrance animation on either of the two boxes below — B982.
          The first attempt faded them in with `motion`, and both are
          server-rendered: `?confirm=1` renders the panel from the query, and a
          303 renders the banner. A `motion` element emits its `initial` styles
          into that HTML, so with JavaScript off — or merely not arrived yet —
          the panel sits at `opacity: 0` with a working submit button
          underneath it. The box a person is meant to read before spending
          their money would be invisible while the thing that spends it was
          not. Watched sitting at zero in a real browser before hydration.

          What this ticket is about is the page not being thrown away and
          redrawn, and that is true whether or not anything fades. The one
          animation kept is the envelope, which is a gesture rather than a way
          of revealing content: it is mounted by a click, so it is never in the
          server's HTML, and nothing is hidden if it never plays. */}
      {result && results[result] ? (
        <p
          id="send-result"
          role="status"
          data-testid="send-result"
          className={`mb-3 scroll-mt-4 rounded-lg border px-3 py-2 text-sm ${
            sent
              ? "border-navy-900 bg-white font-semibold text-navy-900"
              : "border-yellow-300 bg-yellow-50 text-yellow-900"
          }`}
        >
          {results[result]}
        </p>
      ) : null}

      {/* The same card the order reads back as once the cards have gone —
          B1467. It used to be a sentence here and nothing at all afterwards,
          so the only place this order ever named its price was the screen you
          pressed the button on. */}
      <OrderLedgerCard
        ledger={ledger}
        heading={strings.priceHeading}
        totalLabel={strings.priceTotal}
        meta={strings.balance ?? undefined}
      />
      {short && strings.short ? (
        <p className="mt-2 text-sm">
          {strings.short}{" "}
          {/* `Link`, not `<a>` — the shortfall is the one place in this box
              that sends the reader somewhere else, and a full load out of a
              page holding an unsent order is the same jump this ticket is
              about. */}
          <Link className="underline" href={`/${username}/me`}>
            {strings.buy}
          </Link>
        </p>
      ) : null}

      {statusLine ? (
        <p className="mt-2 text-sm">{statusLine}</p>
      ) : sent ? null : step === "confirm" && sendable ? (
        <div className="mt-3 rounded-lg border border-navy-900 bg-white px-4 py-3">
          <p className="font-semibold">{strings.heading}</p>
          <p className="mt-1 text-sm">{strings.body}</p>
          {/* Suppressed when the balance is short: "leaving you -3" is not a
              sentence, and the shortfall line above already says the number
              and where to buy — B606. */}
          {!short ? <p className="mt-1 text-sm">{strings.confirmCost}</p> : null}
          <p className="mt-1 text-sm font-medium">{strings.undone}</p>
          <form
            method="post"
            action={`/${username}/postcards/${id}/send`}
            onSubmit={send}
            className="mt-3 flex flex-wrap items-center gap-3"
          >
            <BusyButton
              ref={sendRef}
              type="submit"
              busy={busy}
              busyLabel={strings.sending}
              className="min-h-11 w-full rounded-full border-2 border-yellow-600 bg-yellow-400 px-5 text-sm font-semibold text-yellow-950 shadow-md transition-all duration-150 hover:bg-yellow-300 hover:shadow-lg focus-visible:ring-4 focus-visible:ring-navy-900 active:translate-y-px active:shadow-sm sm:w-auto"
            >
              {strings.yes}
            </BusyButton>
            <Link
              className="text-sm underline"
              href={`/${username}/postcards/${id}#send`}
              onClick={(e) => {
                e.preventDefault();
                setStep("idle");
              }}
            >
              {strings.back}
            </Link>
          </form>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {/* The warning above the press, in coral, and not below it — B1489.
              It was a grey line under the button, which is where a person
              reads it only after deciding. This is the sentence that says
              real cards and real money, and the drawing puts it in front of
              the press for that reason. Coral, because on this palette that
              is what a thing you cannot undo looks like. */}
          <p className="rounded-r-lg border-l-4 border-coral-600 bg-coral-50 px-3 py-2 text-sm text-coral-600">
            {strings.warning}
          </p>
          {/* A link, not a submit: the first press only *asks*. */}
          <Link
            href={sendable ? `/${username}/postcards/${id}?confirm=1#send` : ""}
            aria-disabled={!sendable}
            onClick={(e) => {
              if (!sendable) return;
              // With JavaScript this is the whole navigation: the second step
              // is already on the page and the URL need not say so.
              e.preventDefault();
              setStep("confirm");
            }}
            className={`inline-flex min-h-11 w-full items-center justify-center rounded-full border-2 px-5 text-sm font-semibold transition-colors sm:w-auto ${
              sendable
                ? "border-yellow-600 bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
                : "pointer-events-none border-navy-200 bg-navy-100 text-navy-400"
            }`}
          >
            {strings.send}
          </Link>
        </div>
      )}
    </section>
  );
}
