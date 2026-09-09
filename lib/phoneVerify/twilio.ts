import "server-only";
import type { CheckResult, PhoneVerifyBackend, StartResult } from "./types";

/**
 * Twilio Verify — the real backend. B1065's "Decided: Twilio Verify".
 *
 * **Verify owns the whole code lifecycle.** This module never generates,
 * stores or counts a code — it makes two calls and reads Twilio's answer.
 * `id` here is the phone number itself, not a Twilio `sid`: Verify's check
 * call is keyed by `To` and `Code`, not by the verification a `start()` call
 * created, so there is nothing else worth calling an id. That also means
 * `check()` can hand the phone straight back on success without a second
 * lookup anywhere.
 */

class TwilioVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwilioVerifyError";
  }
}

function credentials(): { accountSid: string; authToken: string; serviceSid: string } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) {
    throw new TwilioVerifyError(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID must all be set.",
    );
  }
  return { accountSid, authToken, serviceSid };
}

function authHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

async function start(phone: string, locale: string): Promise<StartResult> {
  const { accountSid, authToken, serviceSid } = credentials();
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(accountSid, authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: `+${phone}`, Channel: "sms", Locale: locale }),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new TwilioVerifyError(body.message ?? `Twilio Verify refused the request (HTTP ${response.status})`);
  }
  // The id is the phone number — see the module note above.
  return { id: phone };
}

async function check(id: string, code: string): Promise<CheckResult> {
  const { accountSid, authToken, serviceSid } = credentials();
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(accountSid, authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: `+${id}`, Code: code }),
    },
  );
  if (!response.ok) {
    // Twilio answers 404 (error 20404) for a verification that no longer
    // exists — expired, already approved, or past its own max-attempt
    // ceiling. There is no first-party way from here to tell those apart,
    // and "expired" is the honest single word for all three: none of them is
    // a signal the code just typed was wrong.
    return { status: "expired" };
  }
  const body = (await response.json()) as { status?: string };
  return body.status === "approved" ? { status: "ok", phone: id } : { status: "wrong" };
}

export const twilioPhoneVerify: PhoneVerifyBackend = { name: "twilio", start, check };
