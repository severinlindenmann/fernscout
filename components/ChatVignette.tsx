import Image from "next/image";
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

export default function ChatVignette() {
  const { t } = useI18n();

  return (
    <div className="mt-5 flex max-w-sm flex-col gap-2">
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
                   border border-navy-200 bg-cream-50 px-3.5 py-3"
        style={{ animationDelay: `${dotsDelayMs}ms` }}
      >
        {[0, 120, 240].map((delay) => (
          <span
            key={delay}
            className="fs-waymark-bounce h-1.5 w-1.5 rounded-full bg-navy-400"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
      <div
        className="fs-assemble-in col-start-1 row-start-1 max-w-[88%] rounded-2xl rounded-bl-sm border
                   border-navy-200 bg-cream-50 px-3.5 py-2.5 text-sm leading-relaxed text-navy-800"
        style={{ animationDelay: `${bubbleDelayMs}ms` }}
      >
        {t(textKey)}
      </div>
    </div>
  );
}
