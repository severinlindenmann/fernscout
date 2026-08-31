import "server-only";
import type { Session } from "../auth";
import { serverSite } from "../site";
import { callTool, toolDefinitions } from "./tools";
import pkg from "../../package.json";

/**
 * The Model Context Protocol, as JSON-RPC 2.0.
 *
 * This file is the protocol and nothing else: it does not know about HTTP,
 * headers or authentication. `lib/mcp/http.ts` is the transport and holds all
 * of that, which keeps the two things that get confused for each other — "is
 * this a valid message" and "may this caller send it" — in separate files.
 *
 * Implemented against the 2025-06-18 revision. Two consequences worth naming:
 * JSON-RPC **batching is gone** in that revision, so an array is refused; and
 * a tool result may carry `structuredContent` alongside the text, which the
 * read tools use.
 */

export const LATEST_PROTOCOL_VERSION = "2025-06-18";

/**
 * Versions this server will *accept in a header*, which is a wider set than
 * the one version it implements. A client that negotiated an older revision
 * and keeps stamping its requests with it is talking a dialect this server
 * still understands; refusing it would break the client to prove a point.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** What every agent is told before it calls anything. It is the one rule. */
const INSTRUCTIONS = `This is a travel journal. Its content is markdown and photographs in a folder
the author owns; these tools read and write those files directly.

Everything you create is a DRAFT. It is not on the site, and a person publishes
it. There is no tool, argument or flag here that skips that step, and asking for
one will not produce one.

Write only what you were told. No weather nobody mentioned, no meals nobody ate,
no feelings nobody expressed. If you do not know where a photograph was taken,
leave the location empty and say so — an empty field is a question the author
answers in four seconds, and an invented one is a lie they may never notice.

Read a neighbouring day with get_day before writing one: you are matching a
voice, a language and a length. Then tell the author what you created and that
it is waiting for them.`;

export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export type JsonRpcId = string | number;

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string; data?: unknown } };

export function rpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Handle one JSON-RPC message.
 *
 * Returns `null` for a notification — a message with no `id`, which by the
 * JSON-RPC contract gets no answer. The transport turns that into a 202.
 */
export async function handleRpc(
  message: unknown,
  session: Session,
): Promise<JsonRpcResponse | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return rpcError(null, JSON_RPC_ERRORS.invalidRequest, "Expected a JSON-RPC 2.0 request object.");
  }

  const request = message as Record<string, unknown>;
  const rawId = request.id;
  const id: JsonRpcId | null =
    typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
  const isNotification = rawId === undefined;

  if (typeof request.method !== "string") {
    return isNotification ? null : rpcError(id, JSON_RPC_ERRORS.invalidRequest, "Missing method.");
  }
  const method = request.method;
  const params = asObject(request.params);

  if (isNotification) {
    // `notifications/initialized` and friends. Nothing here needs to react to
    // one yet, and a notification is never answered, so the only correct
    // behaviour is silence.
    return null;
  }
  if (id === null) {
    return rpcError(null, JSON_RPC_ERRORS.invalidRequest, "A request id must be a string or a number.");
  }

  switch (method) {
    case "initialize":
      return rpcResult(id, initializeResult(params));

    case "ping":
      // The spec's keepalive. An empty result is the whole answer.
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: toolDefinitions(session) });

    case "tools/call":
      return toolsCall(id, params, session);

    default:
      return rpcError(id, JSON_RPC_ERRORS.methodNotFound, `Unknown method "${method}".`);
  }
}

function initializeResult(params: Record<string, unknown>) {
  const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
  // "If the server supports the requested protocol version, it MUST respond
  // with the same version. Otherwise, the server MUST respond with another
  // protocol version it supports." We implement exactly one.
  const protocolVersion = requested === LATEST_PROTOCOL_VERSION ? requested : LATEST_PROTOCOL_VERSION;

  return {
    protocolVersion,
    capabilities: {
      // No listChanged: the tool set is fixed at build time, so a subscription
      // would be a promise to send a notification that can never fire.
      tools: { listChanged: false },
    },
    serverInfo: {
      name: "fernscout",
      title: serverSite().name,
      version: pkg.version,
    },
    instructions: INSTRUCTIONS,
  };
}

async function toolsCall(
  id: JsonRpcId,
  params: Record<string, unknown>,
  session: Session,
): Promise<JsonRpcResponse> {
  const name = typeof params.name === "string" ? params.name : "";
  if (!name) return rpcError(id, JSON_RPC_ERRORS.invalidParams, "tools/call needs a tool name.");

  let outcome;
  try {
    outcome = await callTool(name, session, asObject(params.arguments));
  } catch (err) {
    // A thrown handler is this server's bug, not the caller's. It is reported
    // as a tool error rather than a protocol error so the agent can see it and
    // say so, and the message is the exception's own — nothing here reaches a
    // secret, because nothing here holds one.
    return rpcResult(id, toolError(`The tool failed: ${(err as Error).message}`));
  }

  // An unknown tool is a bad argument to tools/call, not a missing method.
  if (outcome === null) {
    return rpcError(id, JSON_RPC_ERRORS.invalidParams, `Unknown tool "${name}".`);
  }
  if (!outcome.ok) return rpcResult(id, toolError(outcome.error));

  return rpcResult(id, {
    content: [{ type: "text", text: outcome.text }],
    structuredContent: outcome.data,
    isError: false,
  });
}

/**
 * A failure the *model* should see and reason about, rather than a protocol
 * error the client would swallow. "That trip does not exist" is information an
 * agent can act on; a JSON-RPC error is a transport problem it cannot.
 */
function toolError(message: string) {
  return { content: [{ type: "text", text: message }], isError: true };
}
