"use client";

import CopyLine from "./CopyLine";
import { useI18n } from "./LocaleProvider";
import { buddyPrompt } from "@/lib/api/agentCopy";

/**
 * What somebody on a trip hands to an agent — B320.
 *
 * The owner has `AgentHandover`, and this is the same job for a different
 * person and a narrower grant. A buddy — named in a trip's `people:`, or
 * approved through a buddy link (B33) — may write days into that trip and may
 * hold a token scoped to it. Until this block existed, nothing they could
 * reach said so: the whole of `/{user}/me` that mentions writing sat inside
 * `{viewer.owner && …}`, and the details panel beside it told them the journal
 * was not theirs to edit. Their write access existed in the database and
 * nowhere in their experience.
 *
 * ## Why there is no button here
 *
 * `AgentHandover` mints a credential on a press, and deliberately does not
 * print one until asked. Nothing is minted here at all: `issueHandover`
 * refuses anybody but the owner, because what it hands over is exchanged for a
 * journal-wide token. So this block is only instructions, and the credential
 * arrives where it already did — by mail, as six digits, through the flow
 * B230 built for this exact person.
 *
 * That makes it static, which is the whole reason it can be rendered without
 * a press and asserted on in a test.
 *
 * ## One block per trip, rather than a chooser
 *
 * A code is bound to one trip when it is issued, and the token it becomes
 * cannot reach a second one. Somebody on two trips therefore needs two
 * prompts, not one prompt with an id to edit — and editing an id inside a
 * pasted prompt is precisely the step that would fail quietly, because the
 * refusal it earns is `/api/auth/verify`'s uniform `invalid_code`.
 *
 * Draws no outer margin: the caller decides where it sits.
 */
export default function BuddyHandover({
  siteUrl,
  username,
  email,
  trips,
}: {
  /** This instance's public base URL, threaded from server config for the
   * reason `AgentHandover` gives — the prompt must name the address the
   * journal answers on, not whatever host this reader reached it through. */
  siteUrl: string;
  username: string;
  /** The address the code will be mailed to. It is the session's own address,
   * so the prompt cannot ask for a code on somebody else's behalf. */
  email: string;
  /** The trips this reader was actually on. The caller filters; this component
   * renders what it is handed and decides nothing about access. */
  trips: { id: string; title: string }[];
}) {
  const { t } = useI18n();
  return (
    <div>
      <h3 className="font-display text-base font-semibold text-navy-900">{t("me.buddyAgent")}</h3>
      <p className="mt-1 text-base leading-7 text-navy-700">{t("me.buddyAgentBody")}</p>

      {trips.map((trip) => (
        <div key={trip.id} className="mt-4">
          {/* Named, and named per block, because the one thing a person has to
              get right here is which prompt goes with which trip. */}
          <p className="text-base font-semibold leading-7 text-navy-900">
            {t("me.buddyFor", { trip: trip.title })}
          </p>
          {/*
            Shown as text rather than hidden behind the button, following the
            same rule as `HandoverPrompt`: somebody is about to paste this into
            software, and a block they cannot read is a block they cannot
            recover when the clipboard fails silently.
          */}
          <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-white p-3 text-xs leading-6 text-navy-900">
            {buddyPrompt({ siteUrl, username, tripId: trip.id, email })}
          </pre>
          <div className="mt-2">
            {/* The accessible name says what the button does rather than
                reciting a multi-line value — B199 — and names the trip,
                because there is one of these per trip. */}
            <CopyLine
              value={buddyPrompt({ siteUrl, username, tripId: trip.id, email })}
              label={t("me.buddyCopy")}
              copiedLabel={t("landing.copied")}
              name={t("me.buddyCopyFor", { trip: trip.title })}
            />
          </div>
        </div>
      ))}

      {/*
        What the key is, and the two limits on it. Each matters to a different
        reader: the buddy needs to know that what they write is not on the site
        yet, and anybody nervous about pasting a credential needs to know how
        far it reaches and that it stops on its own.
      */}
      <p className="mt-4 text-base leading-7 text-navy-700">{t("me.buddyKeyBody")}</p>
      <p className="mt-2 border-l-2 border-coral-600 pl-3 text-base leading-7 text-navy-900">
        {t("me.buddyKeyWarning")}
      </p>
    </div>
  );
}
