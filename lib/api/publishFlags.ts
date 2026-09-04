/**
 * What the publish call was asked to do besides publish.
 *
 * One function, in a file of its own, because the request body belongs to
 * neither channel: `send_mail` is B345's and `send_whatsapp` is B365's, and
 * putting the reader in either module makes the other one import across a
 * seam it has no other reason to cross.
 *
 * **It reads the body exactly once, and that is the whole point.**
 * `Request.json()` consumes the stream. The obvious shape — a
 * `readSendMailFlag` beside a `readSendWhatsappFlag`, each doing its own
 * parse — returns the truth for whichever is called first and `false` for
 * the other, for ever. That failure is invisible: `false` is also what an
 * honest "the caller did not ask for it" looks like, so the feature simply
 * never fires and nothing anywhere reports an error. The two single-flag
 * readers were deleted rather than left available for someone to reach for.
 *
 * Never throws. A malformed or empty body reads as both flags false, which is
 * the default publishing must never silently widen: absence means no letter
 * and no message, because publishing fifteen days must not mail fifteen
 * letters or buzz fifteen times in somebody's pocket.
 */
export type PublishFlags = {
  sendMail: boolean;
  sendWhatsapp: boolean;
};

const NOTHING: PublishFlags = { sendMail: false, sendWhatsapp: false };

export async function readPublishFlags(request: Request): Promise<PublishFlags> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NOTHING;
  }
  if (typeof body !== "object" || body === null) return NOTHING;

  const record = body as Record<string, unknown>;
  // `=== true` rather than truthiness: a client sending `"send_mail": "no"`
  // must not be read as a yes.
  return {
    sendMail: record.send_mail === true,
    sendWhatsapp: record.send_whatsapp === true,
  };
}
