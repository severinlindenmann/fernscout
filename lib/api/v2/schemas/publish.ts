// The publish/send request bodies — B1612 (phase 2 step 3, parcel B).
//
// Neither is a field on the day document: both are a decision about THIS
// publish or THIS send, never stored, so each is its own small schema rather
// than living on `dayWrite`/`dayDoc`.
import { z } from "zod";

/**
 * `POST .../days/{slug}/publish` — content.md §1. `declineTracked` names
 * trip-tracked facts this day genuinely has none of (written into the day's
 * own `declined` map before the completeness check runs, same as v1).
 * `sendMail`/`sendWhatsapp` default to absent — publishing fifteen days must
 * never default to fifteen letters.
 */
export const publishRequest = z.strictObject({
  declineTracked: z.array(z.string()).optional(),
  sendMail: z.boolean().optional(),
  sendWhatsapp: z.boolean().optional(),
});
export type PublishRequest = z.infer<typeof publishRequest>;

/**
 * `POST .../days/{slug}/send` — S1, the one send door. `send-mail` and
 * `send-whatsapp` die into this.
 */
export const sendRequest = z.strictObject({
  channels: z.array(z.enum(["mail", "whatsapp"])).min(1),
});
export type SendRequest = z.infer<typeof sendRequest>;
