import { readJsonBody } from "@/lib/api/jsonBody";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { setGuestSessionCookies } from "@/lib/auth/identityCookie";
import { isEnabled } from "@/lib/capabilities";
import { whatsappCountryCode } from "@/lib/contactNumber";
import { approveContact, manageTokenFor, updateContactSelf, type SelfUpdate } from "@/lib/contacts";
import {
  confirmEmailProof,
  confirmPhoneProof,
  sendEmailProof,
  sendGuestCode,
  sendPhoneProof,
  verifyGuestCode,
} from "@/lib/contacts/guestCode";
import { preapprovedEmailFor } from "@/lib/contacts/invites";
import { journalReader } from "@/lib/contacts/session";
import { markOnboarded, markWelcomeOpened, resolveWelcomeCode } from "@/lib/contacts/welcome";
import { phoneSubject, toE164 } from "@/lib/phone";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** Per IP, and per code: a person steps through six screens and mistypes a
 * code or two; a list of guesses is something else. */
const PER_IP = { max: 60, windowMs: 15 * 60 * 1000 };
const PER_CODE = { max: 40, windowMs: 15 * 60 * 1000 };

const NO = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;
const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: NO });

/**
 * `POST /w/<code>/step` — every write the welcome guide makes (B2293).
 *
 * **The link grants nothing, and neither does this route by itself.** Before
 * the person proves the channel the owner typed, the only things it does are
 * send that channel a code (`send`) and redeem one (`verify`): the subject is
 * built here from the contact the code names — never from the request — so a
 * forwarded link reaches exactly as far as screen 2. Everything after (`save`,
 * `proof`) asks the session: the contact behind `journalReader` must be the
 * one this code names, and its id comes from that session, never the body
 * (B2294's rule). A self write never makes a phone a sign-in number: the
 * address is saved without its `tel`, and a number is only ever proved with
 * `sendPhoneProof` / `confirmPhoneProof`.
 */
export async function POST(request: Request, { params }: RouteContext<"/w/[code]/step">) {
  if (foreignOrigin(request)) return answer(FOREIGN_ORIGIN_REFUSAL, 403);
  const { code } = await params;
  const ip = clientIp(request);
  if (!rateLimitFor("welcome-step-ip", ip, PER_IP).ok || !rateLimitFor("welcome-step-code", code, PER_CODE).ok) {
    return answer({ error: "rate_limited" }, 429);
  }
  const found = isEnabled("contacts") ? await resolveWelcomeCode(code) : null;
  if (!found || !isEnabled("contacts", found.owner)) return answer({ error: "unknown" }, 404);
  const { owner, contact } = found;

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
  const channel = body.channel === "sms" ? "sms" : "email";

  switch (body.action) {
    case "send": {
      const sent = await sendGuestCode(owner, contact.id, channel, { ip, destination: `/w/${code}` });
      return sent.ok ? answer({ ok: true, to: sent.to }) : answer({ error: sent.reason }, sent.reason === "rate_limited" ? 429 : 409);
    }
    case "verify": {
      const digits = contact.phone ? toE164(contact.phone, whatsappCountryCode()) : null;
      const subject = channel === "sms" ? (digits ? phoneSubject(digits) : null) : contact.email.includes("@") ? contact.email : null;
      const session = subject ? await verifyGuestCode(owner, subject, text("code")) : null;
      // The code must have been for *this* contact: a session for anybody
      // else (another contact's number, say) is not this guide's to open.
      if (!session || session.contact?.id !== contact.id) return answer({ error: "invalid_code" }, 401);
      await setGuestSessionCookies(session.token, session.subject, request.headers.get("user-agent"));
      await markWelcomeOpened(owner, contact.id);
      // A mailed invite from before the one-door rebuild (B319): the owner
      // vouched for exactly this address, so proving it lets them in.
      if (
        session.contact.status === "pending" &&
        session.contact.email &&
        (await preapprovedEmailFor(owner, session.contact.createdVia, session.contact.status)) === session.contact.email
      ) {
        await approveContact(owner, contact.id);
      }
      return answer({ ok: true });
    }
  }

  // Everything below is the person's own, signed in as this contact.
  const reader = await journalReader(owner);
  // Blocked is refused here too, not only by `resolveWelcomeCode` above: the
  // two reads are a moment apart and taking access away must win.
  if (!reader.contact || reader.contact.id !== contact.id || reader.contact.status === "blocked") {
    return answer({ error: "not_signed_in" }, 401);
  }
  const self = reader.contact;

  switch (body.action) {
    case "proof": {
      const value = text("value");
      const given = text("code");
      if (body.kind === "sms") {
        if (!given) {
          const sent = await sendPhoneProof(owner, self.id, value, { ip });
          return sent.ok ? answer({ ok: true, to: sent.to }) : answer({ error: sent.reason }, 409);
        }
        return (await confirmPhoneProof(owner, self.id, value, given)) ? answer({ ok: true }) : answer({ error: "invalid_code" }, 401);
      }
      if (!given) {
        const sent = await sendEmailProof(owner, self.id, value, {});
        return sent.ok ? answer({ ok: true, to: sent.to }) : answer({ error: sent.reason }, 409);
      }
      return (await confirmEmailProof(owner, self.id, value, given)) ? answer({ ok: true }) : answer({ error: "invalid_code" }, 401);
    }
    case "save": {
      const patch: SelfUpdate = {};
      if (text("name")) patch.name = text("name");
      const address = body.address as Record<string, unknown> | undefined;
      if (address && typeof address === "object") {
        // No `tel` key: the number already on file is kept as it is.
        const field = (key: string) => (typeof address[key] === "string" ? (address[key] as string) : "");
        patch.address = {
          name: self.name ?? "",
          line1: field("line1"),
          line2: field("line2"),
          postcode: field("postcode"),
          city: field("city"),
          country: field("country"),
        };
      }
      for (const key of ["wantsEmailDigest", "wantsWhatsapp", "wantsSms", "wantsPostcard"] as const) {
        if (typeof body[key] === "boolean") patch[key] = body[key] as boolean;
      }
      const saved = await updateContactSelf(owner, manageTokenFor(owner, self.id), patch);
      if (!saved) return answer({ error: "not_saved" }, 409);
      if (body.done === true) await markOnboarded(owner, self.id);
      return answer({
        ok: true,
        contact: {
          name: saved.name,
          wantsEmailDigest: saved.wantsEmailDigest,
          wantsWhatsapp: saved.wantsWhatsapp,
          wantsSms: saved.wantsSms,
          wantsPostcard: saved.wantsPostcard,
        },
      });
    }
    default:
      return answer({ error: "invalid_request" }, 400);
  }
}
