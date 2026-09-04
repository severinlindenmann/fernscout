import "server-only";
import type { WhatsappMessage, WhatsappPhoto } from "./types";

/**
 * The WhatsApp Cloud API, hosted by Meta — the only backend that really sends.
 *
 * Kept to two calls, because that is all a publish notice needs: upload the
 * photograph, then send the template that references it. Everything about
 * *what* to say was decided before this module was reached.
 *
 * ## The version is pinned, deliberately
 *
 * Meta retires Graph versions on a schedule and changes response shapes
 * between them. An unpinned `/latest` would move under a running deployment
 * with no diff to point at; this way an upgrade is a commit somebody chose.
 */
const GRAPH_VERSION = "v25.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** What Meta answers with when it refuses. Only ever read for its message. */
type GraphError = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
  };
};

export class WhatsappApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsappApiError";
  }
}

/**
 * Turn a Graph failure into one sentence worth putting in front of a person.
 *
 * `error_user_msg` is the one Meta writes for humans — "Das Feld Footer darf
 * maximal 60 Zeichen enthalten" — and it is far more use than the generic
 * `message` beside it, so it wins when present. The numeric code trails
 * because the documentation is indexed by it.
 */
async function failureOf(response: Response): Promise<WhatsappApiError> {
  let body: GraphError = {};
  try {
    body = (await response.json()) as GraphError;
  } catch {
    // A non-JSON body — a proxy error page, a 502. The status is all there is.
  }
  const error = body.error ?? {};
  const detail = error.error_user_msg || error.message || `HTTP ${response.status}`;
  const code = error.code !== undefined ? ` (code ${error.code})` : "";
  return new WhatsappApiError(`${detail}${code}`);
}

export type CloudCredentials = {
  token: string;
  phoneNumberId: string;
};

/**
 * Upload one photograph and get the id the send call references.
 *
 * By **id rather than `link`**, which Meta recommends and which is the only
 * option that is correct here anyway: a `link` would have to be a URL Meta's
 * servers can fetch, and every photograph in this codebase sits behind
 * `mayReadTrip`. Handing over a publicly fetchable URL to a private trip's
 * picture — even a short-lived one — is the thing B345 refused to do for
 * mail, and this at least confines the copy to Meta rather than to anyone
 * who guesses the address.
 *
 * Media ids live 30 days at Meta's end; nothing here keeps one, because the
 * send that uses it happens milliseconds later.
 */
export async function uploadMedia(
  credentials: CloudCredentials,
  photo: WhatsappPhoto,
): Promise<string> {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set(
    "file",
    new Blob([new Uint8Array(photo.data)], { type: photo.contentType }),
    photo.filename,
  );

  const response = await fetch(`${GRAPH}/${credentials.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.token}` },
    body: form,
  });
  if (!response.ok) throw await failureOf(response);

  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new WhatsappApiError("Meta accepted the upload but returned no media id.");
  return body.id;
}

/**
 * Send one template message, and return the `wamid` Meta assigns it.
 *
 * **`accepted` is not `delivered`.** The response says Meta took the message,
 * nothing more: a number with no WhatsApp account, a template whose language
 * does not exist, or a closed 24-hour window all produce a cheerful 200 here
 * and a failure that arrives later on a webhook this instance does not run
 * (B365 explicitly does not do inbound). So the id is a receipt for the
 * handover and the caller must not report it as arrival.
 */
export async function sendTemplate(
  credentials: CloudCredentials,
  message: WhatsappMessage,
  mediaId: string | null,
): Promise<string> {
  const components: Record<string, unknown>[] = [];

  if (mediaId) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { id: mediaId } }],
    });
  }
  if (message.body.length > 0) {
    components.push({
      type: "body",
      parameters: message.body.map((text) => ({ type: "text", text })),
    });
  }
  if (message.buttonPath !== undefined) {
    components.push({
      type: "button",
      sub_type: "url",
      // The first button of the approved template. There is only ever one
      // here; a template with two URL buttons would need its index chosen by
      // the caller, and none does.
      index: "0",
      parameters: [{ type: "text", text: message.buttonPath }],
    });
  }

  const response = await fetch(`${GRAPH}/${credentials.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: message.to,
      type: "template",
      template: {
        name: message.template,
        language: { code: message.language },
        ...(components.length > 0 ? { components } : {}),
      },
    }),
  });
  if (!response.ok) throw await failureOf(response);

  const body = (await response.json()) as { messages?: { id?: string }[] };
  const id = body.messages?.[0]?.id;
  if (!id) throw new WhatsappApiError("Meta accepted the message but returned no id.");
  return id;
}
