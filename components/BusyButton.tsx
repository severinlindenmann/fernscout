"use client";

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

/**
 * A button that says it is working — B867.
 *
 * ## Why this exists
 *
 * Pressing a button that starts network work used to leave the button looking
 * exactly as it did before: no disable on eleven of them, and on the rest a
 * fade to half opacity and a swapped word. On a phone, mid-scroll, the only
 * honest reading available to a person is that the press did not register — so
 * they press again. Two of the buttons this now wraps spend money.
 *
 * The server-side guards are unchanged and are still the thing that makes a
 * double press safe: `claimForSend` in `paid/postcard/lib/postcard/orders.ts` and
 * `lib/idempotency.ts`. This is about what the person sees. A button that lies
 * about whether it heard you is a bug even when the second press is absorbed.
 *
 * ## Two ways to be busy, and why it is one component
 *
 * **`busy` given** — the caller already holds the flag, which most of them do,
 * because they `await fetch(...)` and re-render. Nothing changes for them but
 * the appearance.
 *
 * **`busy` omitted** — the button watches its own `<form>` for a `submit`
 * event and takes it from there. That is what the three native
 * `<form method="post">` posts need: they navigate rather than fetch, so
 * nothing re-renders and there is no state for a caller to hold.
 *
 * That second mode is the reason this is a client component wrapping a plain
 * `<button>` rather than anything cleverer. `paid/postcard/routes/[user]/postcards/[id]/page.tsx`
 * said a spinner "would need JavaScript, and this button's whole design is that
 * it does not" — and that design is right. So this is an *enhancement over* a
 * working native submit and never a replacement for one: with JavaScript off,
 * what is rendered is a `<button type="submit">` inside a form that posts, the
 * effect handler never runs, and the page behaves exactly as it did before.
 * Nothing here is load bearing for the submit itself.
 *
 * The submit listener sits on the form rather than on the button's own click,
 * because a form can also be submitted by pressing Enter in a text field —
 * which is how most people finish a six-digit code — and a click handler would
 * miss every one of those.
 */

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  /** Held by the caller. Omit to have the button watch its own form. */
  busy?: boolean;
  /** Shown in place of `children` while busy. Omit to keep the label. */
  busyLabel?: ReactNode;
  /**
   * B2325 — set by the caller only after a 2xx response, never on tap: the
   * button turns to the success colour and draws a check instead of its
   * label. The caller holds it true for ~900ms (its own `setTimeout`) before
   * its normal continuation runs, and never sets it for a flow whose next
   * screen is itself the confirmation (a `DoneScreen`).
   */
  done?: boolean;
  /**
   * B2325 — any value; the button shakes once whenever this changes to a
   * new truthy one (a caller's error message is the natural value, since it
   * is cleared to `null`/`undefined` at the start of each attempt). Never
   * read otherwise — `SubmitError` itself stays hook-free.
   */
  shake?: unknown;
  /** Forwarded. React 19 takes `ref` as an ordinary prop, but this component
   *  needs one of its own to find its form, so the two are merged below
   *  rather than the caller's being dropped — `IdentitySignIn` focuses this
   *  button, and silently losing that would be a keyboard regression nothing
   *  would have caught. */
  ref?: Ref<HTMLButtonElement>;
};

/**
 * The spinner. An SVG ring rather than a character or a background image, so
 * it inherits `currentColor` and is right on both the navy buttons and the
 * pale ones without either knowing about the other.
 *
 * `motion-reduce:animate-none` with a pulse in its place: somebody who has
 * asked the operating system for less movement still has to be told the button
 * is working, and silence is not the accessible answer — it is the same
 * "nothing happened" this whole ticket is about.
 */
function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 animate-spin motion-reduce:animate-pulse"
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
      />
      <path
        d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * B2325's check — an SVG `path` with `pathLength="1"`, so `stroke-dasharray`/
 * `stroke-dashoffset` mean "the whole path" / "none of it" regardless of the
 * icon's actual size. `.fs-check` in `app/globals.css` holds the base
 * (fully drawn, no motion) and the draw-in animation, gated there on motion
 * preference rather than here.
 */
function Check() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0">
      <path
        d="M3 8.5l3.2 3.2L13 4.8"
        pathLength="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="fs-check"
      />
    </svg>
  );
}

export default function BusyButton({
  busy,
  busyLabel,
  done,
  shake,
  children,
  className,
  // Pulled out of `rest` deliberately. Spreading `rest` after computing
  // `disabled` would let a caller's own `disabled={false}` overwrite the busy
  // one and hand back the double press this component exists to stop.
  disabled,
  style,
  ref: forwarded,
  ...rest
}: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const watching = busy === undefined;

  // B2325 — shakes once each time `shake` changes to a new truthy value.
  // Callers clear their error to `null`/`undefined` at the start of every
  // attempt (every write flow in this app already does), so even a repeat of
  // the exact same message passes through that falsy gap and retriggers this.
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (!shake) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this effect exists to react to `shake` (an external, caller-owned value) changing; there is no non-effect place to catch that.
    setShaking(true);
    const id = setTimeout(() => setShaking(false), 300);
    return () => clearTimeout(id);
  }, [shake]);

  useEffect(() => {
    if (!watching) return;
    const form = ref.current?.form;
    if (!form) return;
    // On a task, not synchronously. A submit button disabled *during* its own
    // submit event is left out of the form data by every browser, which would
    // silently drop the button's name and value — none of the three native
    // forms send one today, and a later one that did would break in a way
    // nobody would think to look here for.
    const onSubmit = () => setTimeout(() => setSubmitting(true), 0);
    form.addEventListener("submit", onSubmit);
    // A navigation the reader came *back* from — the browser's back button, or
    // a bfcache restore — must not leave a permanently spinning button behind
    // on a page that is now idle.
    const onShow = () => setSubmitting(false);
    window.addEventListener("pageshow", onShow);
    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onShow);
    };
  }, [watching]);

  const working = watching ? submitting : busy;

  return (
    <button
      ref={(node) => {
        ref.current = node;
        if (typeof forwarded === "function") forwarded(node);
        else if (forwarded) forwarded.current = node;
      }}
      // `disabled` is what stops the second press; `aria-busy` is what says
      // why, to somebody who cannot see the spinner turning.
      disabled={working || disabled || done}
      aria-busy={working || undefined}
      // `aria-busy:opacity-100!` undoes the caller's own `disabled:opacity-50`
      // for the busy case only, and it is not cosmetic: nearly every button
      // here fades when disabled, so the spinner arrived at half strength on a
      // button that had already dimmed — a working control looking exactly as
      // dead as an unavailable one. Busy and unavailable are different states
      // and must not look the same. A plain `disabled` still fades.
      className={`inline-flex items-center justify-center gap-2 aria-busy:opacity-100!${shaking ? " fs-shake" : ""}${className ? ` ${className}` : ""}`}
      // Inline, not a class: a caller's own tone class (`bg-action-strong`,
      // `bg-yellow-400`, …) and this one both set `background-color`, and
      // which utility wins is decided by generation order in the compiled
      // stylesheet, not by position in `className` — inline style is the
      // only way this reliably beats every tone this component is handed.
      style={done ? { ...style, backgroundColor: "var(--color-green-700)", color: "var(--color-on-deep)" } : style}
      {...rest}
    >
      {done ? <Check /> : working ? <Spinner /> : null}
      {done ? null : working && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}
