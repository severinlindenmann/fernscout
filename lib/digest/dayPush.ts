import "server-only";
import { translateIn } from "../locales";
import type { Composition, PreviewLocale } from "../messages/previews/types";

/**
 * `news.push`'s composition — pure, B2493, pulled out of the publish route
 * (`app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route.ts`) — a
 * `route.ts` may only export HTTP handlers, so the composer lives here and
 * the route imports it.
 */
export function composeDayPush(
  input: { journalTitle: string; dayTitle: string },
  locale: PreviewLocale,
): Composition {
  return {
    channel: "push",
    title: input.journalTitle,
    text: translateIn(locale, "push.newDay.body", { day: input.dayTitle }),
  };
}
