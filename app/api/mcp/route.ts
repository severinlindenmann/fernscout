import { handleMcpPost, handleMcpUnsupportedMethod } from "@/lib/mcp/http";

// Never prerendered and never cached: every response depends on a bearer token
// and on files that change while the site is running.
export const dynamic = "force-dynamic";

/**
 * The MCP endpoint — a second door onto the same content as `/api/v1/…`.
 *
 * Everything is in `lib/mcp/`: the transport and authorisation in `http.ts`,
 * the JSON-RPC protocol in `server.ts`, the tools in `tools.ts`. This file is
 * deliberately three lines of plumbing, so the protocol can be tested without
 * booting Next.
 */
export const POST = handleMcpPost;
export const GET = handleMcpUnsupportedMethod;
export const DELETE = handleMcpUnsupportedMethod;
