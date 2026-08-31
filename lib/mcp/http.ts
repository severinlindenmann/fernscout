import "server-only";
import { resolveSession, type Session } from "../auth";
import { isEnabled } from "../capabilities";
import { rateLimitFor, clientIp } from "../rateLimit";
import { serverSite } from "../site";
import { JSON_RPC_ERRORS, SUPPORTED_PROTOCOL_VERSIONS, handleRpc, rpcError } from "./server";

/**
 * MCP over **Streamable HTTP** — one endpoint, POST carrying JSON-RPC.
 *
 * SSE-as-a-transport is the legacy shape (protocol revision 2024-11-05) and is
 * not implemented. Streamable HTTP permits a server to answer a POST with
 * either `application/json` or an SSE stream, and every tool here completes in
 * a single filesystem pass with nothing to stream, so this server always
 * answers with JSON. GET is answered `405`, which the specification names as
 * the correct response from a server that offers no server-initiated stream.
 *
 * It is also **stateless**: no `Mcp-Session-Id` is issued, so there is no
 * session to resume, nothing to expire on a restart and no DELETE to honour.
 * The security properties that would come from a session id are provided by
 * the bearer token instead, which is durable, revocable and already exists.
 *
 * ## Authorisation, honestly
 *
 * The specification's answer is OAuth 2.1 with PKCE against a separate
 * authorization server. This server is an OAuth *resource* server only: it
 * validates bearer tokens it issued itself through `/api/auth/*`, and it
 * publishes RFC 9728 protected-resource metadata so a client is told what it
 * is talking to. There is no authorization server and therefore no browser
 * flow — a person obtains a token by email code and hands it over. What that
 * does and does not buy is written down in docs/providers/mcp.md rather than
 * papered over here.
 *
 * The rule this server does honour without qualification: **a client's token
 * is never passed to anything downstream.** The tools reach the filesystem and
 * nothing else, so there is no downstream to pass it to.
 */

/** RFC 9728 §3.1: the metadata URL inserts the well-known segment *before* the
 * resource's path, so both of these must answer. */
export const RESOURCE_METADATA_PATHS = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/api/mcp",
];

export function mcpEndpoint(): string {
  return `${serverSite().url}/api/mcp`;
}

/**
 * RFC 9728 protected-resource metadata.
 *
 * `authorization_servers` is deliberately **absent**, and its absence is the
 * honest statement: there is no authorization server to point at. A client
 * that requires one will discover that here, from a document, rather than by
 * failing halfway through a flow that was never going to complete.
 */
export function protectedResourceMetadata(): Record<string, unknown> {
  const site = serverSite();
  return {
    resource: mcpEndpoint(),
    scopes_supported: ["write:content"],
    bearer_methods_supported: ["header"],
    resource_name: `${site.name} — travel journal`,
    resource_documentation: `${site.url}/agent.md`,
    resource_policy_uri: `${site.url}/documentation.txt`,
  };
}

/** The `WWW-Authenticate` challenge RFC 9728 §5.1 asks a resource server for. */
function challenge(error?: string, description?: string): string {
  const parts = [
    `Bearer realm="fernscout"`,
    `resource_metadata="${serverSite().url}${RESOURCE_METADATA_PATHS[0]}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return parts.join(", ");
}

function unauthorized(error: string, description: string): Response {
  return Response.json(
    { error, error_description: description },
    { status: 401, headers: { "WWW-Authenticate": challenge(error, description) } },
  );
}

function jsonRpc(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Origin checking, which the transport specification requires.
 *
 * Its purpose is DNS rebinding: a page on any origin can POST JSON to this
 * endpoint from a browser, and if a token ever reached one, that page could
 * spend it. A request with no `Origin` at all is a non-browser client, which is
 * what every MCP client actually is, and is allowed.
 */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") {
      return true;
    }
    return url.origin === new URL(serverSite().url).origin;
  } catch {
    return false;
  }
}

async function authenticate(request: Request): Promise<{ ok: true; session: Session } | { ok: false; response: Response }> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      ok: false,
      response: unauthorized("invalid_request", "Send an agent token as Authorization: Bearer <token>."),
    };
  }

  // `"agent"` is the whole access-control decision. A guest cookie presented
  // here as a bearer token is refused by class, before anything asks what it
  // can reach — a session that can read the site for a year must not be a
  // session that can write to it (decision 24).
  const session = await resolveSession(match[1].trim(), "agent");
  if (session) return { ok: true, session };

  // Only *failures* are counted. A wrong token is cheap to try, so trying
  // thousands is bounded; a working client never touches this, which is what
  // keeps a busy agent from rate-limiting itself out of its own journal.
  const limit = rateLimitFor("mcp-auth", clientIp(request), { max: 30, windowMs: 60_000 });
  if (!limit.ok) {
    return {
      ok: false,
      response: Response.json(
        { error: "rate_limited", retry_after: limit.retryAfter },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      ),
    };
  }

  return {
    ok: false,
    response: unauthorized("invalid_token", "That token is unknown, expired, revoked, or not an agent token."),
  };
}

/** POST — the whole protocol. */
export async function handleMcpPost(request: Request): Promise<Response> {
  // Auth is a capability. With it off there is no token to present and no way
  // to be authorised, so the endpoint is absent rather than permanently 401 —
  // "off means absent, not broken" (ROADMAP §1.1).
  if (!isEnabled("auth")) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }

  if (!originAllowed(request)) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  // Before `initialize` there is no negotiated version, so the header is
  // absent; after it, a client stamps every request. An unknown value is a
  // client speaking a dialect this server does not, which the specification
  // says to answer with 400 rather than to guess at.
  const version = request.headers.get("mcp-protocol-version");
  if (version && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return Response.json(
      { error: "unsupported_protocol_version", supported: SUPPORTED_PROTOCOL_VERSIONS },
      { status: 400 },
    );
  }

  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpc(rpcError(null, JSON_RPC_ERRORS.parseError, "Request body is not JSON."), 400);
  }

  // Batching was removed in the 2025-06-18 revision. Refusing it by name beats
  // answering the first element and silently dropping the rest.
  if (Array.isArray(body)) {
    return jsonRpc(
      rpcError(
        null,
        JSON_RPC_ERRORS.invalidRequest,
        "JSON-RPC batching was removed in MCP 2025-06-18. Send one request per POST.",
      ),
      400,
    );
  }

  const response = await handleRpc(body, auth.session);

  // A notification gets no body. 202 is what the transport specification asks
  // for, and it is not the same as an empty 200.
  if (response === null) {
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  }

  return jsonRpc(response);
}

/**
 * GET — no server-initiated stream is offered here, and 405 is how a
 * Streamable HTTP server says so. DELETE gets the same answer for the same
 * reason: there is no session id, so there is no session to end.
 */
export function handleMcpUnsupportedMethod(): Response {
  return Response.json(
    {
      error: "method_not_allowed",
      detail:
        "This MCP endpoint is stateless Streamable HTTP: POST a single JSON-RPC request. " +
        "No server-initiated SSE stream and no session id are offered.",
    },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}
