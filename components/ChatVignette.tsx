import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The chat vignette on the signed-out `/agent` door — B1329.
 *
 * Four bubbles, static content, arriving once on first paint with no JS
 * timer and no replay button: `fs-assemble-in` (the bubbles) and
 * `fs-chat-dots` (the typing placeholder ahead of each agent reply) are
 * plain `@keyframes` in `app/globals.css`, both already the idiom this
 * codebase uses for a once-only arrival (`fs-assemble-in` is `HelperAsk`'s
 * own `TurnLoader`). `prefers-reduced-motion: reduce`, handled in the same
 * file, turns the bubbles' animation off (they show immediately, in their
 * resting `opacity: 1` state) and removes the dots outright rather than
 * leaving them static.
 *
 * The dots and the bubble beneath each agent reply sit in the same grid
 * cell (`grid-area: 1 / 1`) so the dots can fade to nothing exactly as the
 * bubble fades in, with no layout shift and no `display` to animate.
 *
 * Own bubbles are `yellow-300` — the brand colour, not WhatsApp green: the
 * point of this vignette is that it is the same conversation on every
 * channel. Agent bubbles are `cream-50` with a `navy-200` edge, the same
 * surface the question card below uses.
 *
 * Thumbnails are three already-shipped derivatives from the `example`
 * journal's own `oregon-coast` update (never new binaries in the repo), read
 * through the ordinary media route and its loader — the same gate that
 * decides whether any trip photo is visible to whoever is asking. They are
 * that update's own public photographs (`04.jpg` in the same gallery is
 * `visibility: private` and is deliberately not one of these three) — dunes,
 * the beach, and the rained-on leaf the real entry opens on.
 */

const THUMBS = [
  "/example/media/usa-2026/oregon-coast/02.jpg",
  "/example/media/usa-2026/oregon-coast/03.jpg",
  "/example/media/usa-2026/oregon-coast/01.jpg",
];

/**
 * The day those photographs belong to — B1717.
 *
 * Beside `THUMBS` and not anywhere else, because the two have to name the
 * same day and the way that breaks is one of them being edited alone. Until
 * B1717 the bubbles described a different day from the pictures: they said
 * "the kids went looking for amber" on "September 10" over three photographs
 * from *Down the Oregon coast*, 24 August. Nobody had invented a journal —
 * the words were written as filler and the photographs chosen later — but the
 * landing page now captions this as a real exchange, and a caption is a claim.
 */
const DAY = { user: "example", trip: "usa-2026", slug: "oregon-coast" };
const DAY_HREF = `/${DAY.user}/trips/${DAY.trip}/day/${DAY.slug}`;

export default function ChatVignette({ caption = false }: { caption?: boolean }) {
  const { t } = useI18n();
  const stage = useRef<HTMLDivElement>(null);
  /**
   * Whether the conversation has been looked at yet — B1722.
   *
   * Starts held, which is `animation-play-state: paused` on everything
   * inside, and is released the first time any part of the vignette enters
   * the viewport. Released once and never re-held: this is an arrival, not a
   * loop, and replaying it under somebody scrolling up and down would be a
   * fidget rather than a demonstration.
   *
   * On `/agent` the vignette is already on screen at first paint, so the
   * observer fires immediately and nothing about that page changes.
   *
   * A browser with no `IntersectionObserver` releases it at once rather than
   * holding a conversation nobody can start — the animation is the garnish
   * and the words are the content.
   */
  const [held, setHeld] = useState(true);

  useEffect(() => {
    const el = stage.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setHeld(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHeld(false);
          observer.disconnect();
        }
      },
      // A little before the edge, so the first bubble is already moving by
      // the time the block is properly in the reader's field of view.
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={stage}
      className={`mt-5 flex max-w-sm flex-col gap-2${held ? " fs-hold-animation" : ""}`}
    >
      <OwnBubble delayMs={500}>
        <div className="mb-1.5 flex gap-1.5">
          {THUMBS.map((src) => (
            <Image
              key={src}
              src={src}
              loader={mediaLoader}
              alt=""
              width={74}
              height={56}
              className="h-14 w-[74px] flex-shrink-0 rounded-lg object-cover shadow-sm"
            />
          ))}
        </div>
        {t("agent.chatOwn1")}
        <Tick />
      </OwnBubble>

      <AgentTurn dotsDelayMs={1200} bubbleDelayMs={2200} textKey="agent.chatAgent1" />

      <OwnBubble delayMs={3200}>
        {t("agent.chatOwn2")}
        <Tick />
      </OwnBubble>

      <AgentTurn dotsDelayMs={3900} bubbleDelayMs={4900} textKey="agent.chatAgent2" />

      {/* The landing page's half — B1717. `/agent` shows the vignette to
          somebody who has already decided and is about to sign in, so a line
          sending them off to read a stranger's holiday would be a step
          backwards; the root shows it to somebody still deciding, for whom
          the finished day is the most persuasive thing on the instance. It
          links to the day itself rather than to the journal's front page:
          watching a day be written and landing on that exact day finished is
          the whole argument in two clicks. */}
      {caption && (
        <p className="mt-1 text-xs leading-5 text-ink-secondary">
          {t("landing.vignetteCaption")}{" "}
          <Link
            href={DAY_HREF}
            className="font-semibold underline decoration-blue-500 decoration-2 underline-offset-2
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {t("landing.vignetteDay")}
          </Link>
        </p>
      )}
    </div>
  );
}

/** WhatsApp-style double tick — decorative, the bubble's own text already
 *  says what happened. */
function Tick() {
  return (
    <div aria-hidden className="mt-0.5 text-right text-[10px] text-yellow-950/60">
      ✓✓
    </div>
  );
}

function OwnBubble({ delayMs, children }: { delayMs: number; children: React.ReactNode }) {
  return (
    <div
      className="fs-assemble-in ml-auto max-w-[88%] rounded-2xl rounded-br-sm bg-yellow-300 px-3.5 py-2.5
                 text-sm leading-relaxed text-yellow-950"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}

function AgentTurn({
  dotsDelayMs,
  bubbleDelayMs,
  textKey,
}: {
  dotsDelayMs: number;
  bubbleDelayMs: number;
  textKey: TranslationKey;
}) {
  const { t } = useI18n();
  return (
    <div className="grid">
      <div
        aria-hidden
        className="fs-chat-dots col-start-1 row-start-1 flex w-fit items-center gap-1 rounded-2xl rounded-bl-sm
                   border border-line-quiet bg-surface-base px-3.5 py-3"
        style={{ animationDelay: `${dotsDelayMs}ms` }}
      >
        {[0, 120, 240].map((delay) => (
          <span
            key={delay}
            className="fs-waymark-bounce h-1.5 w-1.5 rounded-full bg-action-strong"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
      <div
        className="fs-assemble-in col-start-1 row-start-1 max-w-[88%] rounded-2xl rounded-bl-sm border
                   border-line-quiet bg-surface-base px-3.5 py-2.5 text-sm leading-relaxed text-ink-strong"
        style={{ animationDelay: `${bubbleDelayMs}ms` }}
      >
        {t(textKey)}
      </div>
    </div>
  );
}
