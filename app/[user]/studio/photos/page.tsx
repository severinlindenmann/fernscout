import ExtractFlow from "@/components/extract/ExtractFlow";
import StudioPage from "@/components/studio/StudioPage";
import { isEnabled } from "@/lib/capabilities";
import { hasHelperConsent } from "@/lib/helper/consent";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { speechLanguageFor } from "@/lib/helper/speech";
import { speechProvider } from "@/lib/helper/transcribe";
import { defaultLocaleFor, requestLocale, translateIn } from "@/lib/locales";
import { getTrips } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * The guided camera-roll flow — B1751, moved here from `/<user>/extract` by
 * B1797, and from there to `/<user>/studio/photos` by B1825: the studio hub
 * absorbed the import hub (spec.md's "the destination is /[user]/studio,
 * with the import flows under it"), and this is the one hub entry whose flow
 * already existed rather than being built fresh. `next.config.ts` 301s the
 * old `/extract/photos` address so a bookmark or an already-sent link
 * converges here rather than 404ing.
 *
 * `trips` is this owner's own trip list, for Step 02's "add to a trip you
 * have" — `getTrips(username)` directly, the same function every other
 * owner-facing trip page already calls server-side
 * (`app/[user]/trips/page.tsx`, `app/[user]/layout.tsx`'s own trip
 * switcher), rather than a new client route. The owner is looking at their
 * own journal here, so nothing needs `listableTrips`'s reader-side filter.
 *
 * `StudioPage` draws the frame, the title and the way back (B2068). With the
 * `extract` capability off the owner gets `CapabilityOffStep` with its
 * reason, never a 404 — the owner check still comes first, so a stranger
 * learns nothing about whether it is on.
 */
export default async function StudioPhotosPage({ params }: PageProps<"/[user]/studio/photos">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const locale = await requestLocale();
  const title = translateIn(locale, "studio.photos.title");
  if (!isEnabled("extract", user)) {
    return (
      <StudioPage
        username={user}
        group="bringIn"
        title={title}
        capabilityOff={{
          banner: translateIn(locale, "studio.extract.off.banner"),
          body: translateIn(locale, "studio.extract.off.body"),
        }}
      />
    );
  }
  const trips = getTrips(user).map((trip) => ({
    id: trip.id,
    title: trip.title,
    year: trip.start.slice(0, 4),
  }));
  // Transcription is an optional capability (AGENTS.md) and it must be
  // absent, not broken, when this instance has it off — B1803 Task 3.3/3.4
  // put a whole voice-first screen where there used to be one small mic
  // icon, so a caller with the capability off must never even try to
  // consent or record. `""` (never a real `speechProvider()`, always a
  // string) is what `AskCard`/`RecordButton` treat as "there is no speech
  // here at all", matching the pattern `app/[user]/search/page.tsx` already
  // uses for the same capability.
  const transcriptionOn = isEnabled("transcription", user);
  // The mode screen's own "which language" question (B1803 Task 4.1)
  // defaults to the journal's own locale, never the reader's UI language —
  // `speechLanguageFor` with no override or UI fallback is exactly
  // `supported(defaultLocaleFor(user))`, the same preference the transcribe
  // route itself gives the journal's locale over anything else. `"en"` only
  // when the journal is written in a language this cannot transcribe at
  // all, matching every other unsupported-language fallback in this file.
  const defaultSpeechLanguage = speechLanguageFor(null, defaultLocaleFor(user)) ?? "en";
  return (
    <StudioPage username={user} group="bringIn" title={title}>
      <ExtractFlow
        username={user}
        consentedSpeech={transcriptionOn && hasHelperConsent(user, "speech")}
        speechProvider={transcriptionOn ? speechProvider() : ""}
        defaultSpeechLanguage={defaultSpeechLanguage}
        trips={trips}
      />
    </StudioPage>
  );
}
