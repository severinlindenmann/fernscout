"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * Look, Write, Send — B1005.
 *
 * The page used to ask for six unrelated things in one column: where the
 * photograph sits, what the card says, who signs it, which language, whether
 * the figures print, and then — under two warnings and a list of addresses —
 * whether to spend the credits. On a phone the thing you came to do was at the
 * bottom of a very long scroll.
 *
 * This is the same six things in three groups, one at a time, and it is
 * deliberately thin: it owns which step is showing and nothing else. The
 * panels arrive as props — server-rendered, holding the existing
 * `PostcardCropper`, `PostcardBack` and `PostcardSend` — so nothing about how
 * a card is cropped, written or sent passes through here. React lets a client
 * component take server-rendered children; that is the whole trick, and it is
 * why the page above is still a server component.
 *
 * ## Every panel is in the DOM, always
 *
 * Not a router, not three URLs, and not a mount/unmount: the inactive panels
 * are rendered and hidden. Three reasons, in the order they matter.
 *
 * **With JavaScript off, the stepper does not exist and all three panels are
 * simply on the page** — which is exactly the page as it was, in one scroll.
 * `stepped` starts false and an effect turns it on, so the server's HTML is
 * the complete flow and hydration is what folds it up. The same rule the send
 * button has carried since B466: an enhancement over something that already
 * works, never the only way through.
 *
 * **Unmounting a panel would throw away work.** `PostcardBack` saves what you
 * type on a 700ms debounce; a step change inside that window would take the
 * last keystrokes with it. Hidden, its state and its timer survive.
 *
 * **The browser can still find things.** In-page search, an autofill pass and
 * `#send` all work on hidden content in a way they do not on content that was
 * never rendered.
 *
 * `hidden` rather than a class, because it is the attribute that means this:
 * assistive technology skips a hidden subtree, where `display:none` from a
 * utility class is a fact about painting that a screen reader is entitled to
 * ignore.
 */

export type StepName = "look" | "write" | "send";

/**
 * One step's panel: present always, hidden unless it is the one showing.
 *
 * `hidden` rather than a class, because it is the attribute that means this —
 * assistive technology skips a hidden subtree, where `display:none` from a
 * utility class is a fact about painting that a screen reader is entitled to
 * ignore.
 */
function Panel({
  name,
  step,
  stepped,
  label,
  children,
}: {
  name: StepName;
  step: StepName;
  stepped: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section hidden={stepped && name !== step}>
      {/* The heading is for the unstepped page — with the bar above, the
          step's name is already on screen and repeating it is furniture. It
          stays in the accessibility tree either way, which is what gives a
          screen reader its landmark. */}
      <h2
        className={`font-display text-lg font-semibold text-navy-900 ${
          stepped ? "sr-only" : "mb-3 mt-8 first:mt-0"
        }`}
      >
        {label}
      </h2>
      {children}
    </section>
  );
}

const ORDER: StepName[] = ["look", "write", "send"];

export default function PostcardSteps({
  opening,
  lookPanel,
  writePanel,
  sendPanel,
  labels,
  next,
  back,
  /** Start on the send step. The `?result=` and `?confirm=1` redirects land
   * here, and a reader coming back from a form post is not asking to be shown
   * the cropping again. */
  start = "look",
  /** Nothing left to do: the order has been sent, or it expired. The steps
   * still render — the card is worth looking at afterwards — but the flow
   * opens where the outcome is. */
  settled = false,
}: {
  /** The card a proposal opens on, before the steps — B1490. Absent for an
   *  order that is not a fresh proposal. */
  opening?: {
    eyebrow: string;
    title: string;
    body: string;
    note: string;
    label: string;
    media: React.ReactNode;
  };
  lookPanel: React.ReactNode;
  writePanel: React.ReactNode;
  sendPanel: React.ReactNode;
  /** The three names, in the reader's language. */
  labels: { look: string; write: string; send: string; of: string };
  /** "Looks right" / "Ready to send" — the forward button per step. */
  next: { look: string; write: string };
  back: string;
  start?: StepName;
  settled?: boolean;
}) {
  /**
   * Whether this is running in a browser that got as far as hydrating.
   *
   * `useSyncExternalStore` with a server snapshot of `false` and a client one
   * of `true` is React's own answer to that question: it renders `false` on
   * the server *and* through hydration, then `true`. An effect that called
   * `setState` would do the same thing and is what this was first written as —
   * the lint rule that refuses it is right, since a state write in an effect
   * on every mount is a second render nobody asked for. Nothing subscribes,
   * because the answer never changes after the first paint.
   */
  const stepped = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [step, setStep] = useState<StepName>(settled ? "send" : start);
  /**
   * Whether the opening card has been pressed through — B1490.
   *
   * A proposal used to land the owner on the cropper, with a slider under
   * their thumb before they had been told what they were looking at. The
   * drawing opens on a card instead: the front, what it is, and the sentence
   * that matters — nothing has been printed or charged, and nothing will be
   * until you press send.
   *
   * Not persisted, and not a setting: it is an opening. Coming back to the
   * page opens it again, which is right for a card that says what the page
   * is about.
   */
  const [opened, setOpened] = useState(false);

  const index = ORDER.indexOf(step);

  /* Only for a proposal nobody has touched yet: an order the owner is
     already part-way through (arriving on `send` from a failed press, or
     confirming) has nothing to be introduced to. */
  const introducing = opening !== undefined && !opened && !settled && start === "look";

  if (introducing) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-navy-500">
            {opening.eyebrow}
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold text-navy-900">
            {opening.title}
          </h2>
          <p className="mt-2 text-sm text-navy-600">{opening.body}</p>
        </div>
        {opening.media}
        <div className="rounded-xl border border-navy-200 bg-white px-4 py-3">
          <p className="text-sm text-navy-700">{opening.note}</p>
        </div>
        <div>
          <button
            type="button"
            onClick={() => setOpened(true)}
            className="min-h-11 w-full rounded-full border-2 border-yellow-600 bg-yellow-400 px-5 text-sm font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 sm:w-auto"
          >
            {opening.label}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {stepped ? (
        <nav
          aria-label={`${labels.look} · ${labels.write} · ${labels.send}`}
          className="mb-6 flex flex-wrap items-center gap-2"
        >
          {ORDER.map((name, i) => {
            const active = name === step;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setStep(name)}
                aria-current={active ? "step" : undefined}
                /* The current step wears the yellow — B1489, the drawing's
                   own bar. Navy-on-white filled the whole pill with the
                   colour this palette keeps for type, and read as a button
                   that had just been pressed rather than as where you are. */
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-xs font-bold uppercase tracking-wider transition-colors ${
                  active
                    ? "border-yellow-600 bg-yellow-400 text-yellow-950"
                    : "border-navy-200 bg-white text-navy-500 hover:border-navy-400"
                }`}
              >
                {/* The number is not decoration: these are steps in an order,
                    and the numeral is what says so at a glance on a bar that
                    is otherwise three words. */}
                <span
                  aria-hidden="true"
                  className={`font-mono text-[0.65rem] ${active ? "text-yellow-950/60" : "text-navy-400"}`}
                >
                  {i + 1}
                </span>
                {labels[name]}
              </button>
            );
          })}
          <span className="ml-auto font-mono text-xs text-navy-500">
            {index + 1} {labels.of} 3
          </span>
        </nav>
      ) : null}

      {/* Three siblings written out rather than `ORDER.map(...)`, and the
          difference is not style. The panels are server-rendered and handed
          over as props, so a `.map` here puts elements this component did not
          create into a dynamic array — React then asks for a `key` on
          something the page owns, which the page cannot sensibly give and
          which no test in a browser reproduces, because the warning only
          appears across the server boundary. Three lines, no array, no
          warning. */}
      <Panel name="look" step={step} stepped={stepped} label={labels.look}>
        {lookPanel}
      </Panel>
      <Panel name="write" step={step} stepped={stepped} label={labels.write}>
        {writePanel}
      </Panel>
      <Panel name="send" step={step} stepped={stepped} label={labels.send}>
        {sendPanel}
      </Panel>

      {stepped && step !== "send" ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setStep(ORDER[index + 1])}
            /* Yellow, and full width on a phone — B1489. It is the forward
               action of the step and the drawing gives it the same weight as
               the press at the end; navy-on-white made it the third-heaviest
               thing on a screen whose whole job is "go on". Nothing here
               spends: the one button that does is on the send panel. */
            className="min-h-11 w-full rounded-full border-2 border-yellow-600 bg-yellow-400 px-5 text-sm font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 sm:w-auto"
          >
            {step === "look" ? next.look : next.write}
          </button>
          {index > 0 ? (
            <button
              type="button"
              onClick={() => setStep(ORDER[index - 1])}
              className="min-h-11 text-sm underline"
            >
              {back}
            </button>
          ) : null}
        </div>
      ) : null}

      {stepped && step === "send" ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setStep("write")}
            className="min-h-11 text-sm underline"
          >
            {back}
          </button>
        </div>
      ) : null}
    </div>
  );
}
