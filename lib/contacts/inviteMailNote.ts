import { mailDisabledReason } from "../mail";

/**
 * The owner's note when a mailed invite failed to send — B407.
 *
 * `sent` being false used to be blamed on the server unconditionally, which
 * left an owner staring at a healthy `/api/health` after switching mail off
 * for their own journal, not the instance. `mailDisabledReason` reads the same
 * two checks `sendMail` itself makes, so this says which one is actually off
 * and points at the one the owner can change themselves. A `null` reason means
 * neither switch was it, and the send genuinely failed — kept in a function a
 * test can call directly rather than going through the whole route.
 */
export function mailFailedNote(rawEmail: string, username: string): string {
  const suffix =
    "The link above still works and that address is still pre-approved; send it another way.";
  const reason = mailDisabledReason(username);
  if (reason === "journal") {
    return (
      `Could not send to ${rawEmail} — this journal's own mail is switched off. Turn it ` +
      `back on through PATCH /api/v2/${username}. ${suffix}`
    );
  }
  if (reason === "server") {
    return (
      `Could not send to ${rawEmail} — this server's mail is off. The person who runs it ` +
      `has to turn it on; /api/health says why. ${suffix}`
    );
  }
  return `Could not send to ${rawEmail} — the mail failed to send. ${suffix}`;
}

/** B2442 — the studio's note when an invite was refused, not merely
 * failed: this person asked, on the public `/x/<token>` page, never to be
 * invited again. Nothing was sent. */
export function inviteSuppressedNote(rawEmail: string): string {
  return (
    `Could not send to ${rawEmail} — this person asked not to be invited. The link above still ` +
    "works and that address is still pre-approved; send it another way only if you know them personally."
  );
}
