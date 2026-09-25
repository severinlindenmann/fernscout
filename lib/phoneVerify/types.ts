/**
 * Proving a telephone number — B1065.
 *
 * **This is not a transport, and the seam is not "send this SMS".** The
 * obvious shape — copy `lib/mail` and `lib/whatsapp`, an interface with a
 * `send()` — assumes *we* generate the code, store it, count attempts and
 * expire it, with a backend that only delivers it. Twilio Verify does not
 * work that way: it owns the whole code lifecycle. A transport interface
 * bent to fit it can only be backed by Twilio's raw Programmable SMS, which
 * brings back everything Verify was chosen to avoid — an alphanumeric sender
 * id, its per-country registration, the Austrian deadline.
 *
 * So the seam is at the altitude of the capability itself: **prove this
 * number**, not **send this message**.
 *
 *   startVerification(phone, locale) -> { id }
 *   checkVerification(id, code)      -> { status: "ok", phone } | { status: "wrong" | "expired" | "burned" }
 *
 * `dry-run` makes its own code, writes it where a dry-run mail already goes,
 * and checks it against `login_codes` with a `phone` kind — this
 * repository's own discipline: hash only, five attempts, thirty minutes,
 * superseded on reissue. **Deliberately not a fifth `SessionKind`** — a phone
 * proof opens no session, so it has no business in the union `lib/auth`
 * checks every credential against; it is a plain string on the same table,
 * modelled on `issueCode`/`verifyCode` rather than calling them.
 *
 * `twilio` delegates both calls to Verify and never touches `login_codes` —
 * the code, its storage, its attempt count and its expiry are all Twilio's.
 * One honest cost of the split, worth carrying into any change here: in
 * development the attempt counter and the TTL are ours, and in production
 * they are Twilio's, so a bug in *our* handling cannot show up in production
 * and a difference in *Twilio's* cannot show up in development — the same
 * trade `file` versus `smtp` mail already makes.
 */

export type StartResult = { id: string };

export type CheckResult =
  | { status: "ok"; phone: string }
  | { status: "wrong" | "expired" | "burned" };

export interface PhoneVerifyBackend {
  readonly name: string;
  start(phone: string, locale: string): Promise<StartResult>;
  check(id: string, code: string): Promise<CheckResult>;
}
