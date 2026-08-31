import { protectedResourceMetadata } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

/**
 * RFC 9728 protected-resource metadata for the MCP endpoint.
 *
 * Served at `/.well-known/oauth-protected-resource` and at
 * `/.well-known/oauth-protected-resource/api/mcp` through rewrites in
 * next.config.ts — a route handler cannot live at a dot-prefixed path, and the
 * RFC constructs the URL by inserting the well-known segment before the
 * resource's own path, so both forms have to answer.
 *
 * CORS is open because this document is meant to be read by a client before it
 * has any credential, and it contains nothing that is not already public.
 */
export function GET() {
  return Response.json(protectedResourceMetadata(), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
