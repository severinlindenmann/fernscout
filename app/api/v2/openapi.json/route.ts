import { withV2Log } from "@/lib/api/v2/route";
// GET /api/v2/openapi.json — the v2 machine contract, generated from the
// frozen Zod schemas in lib/api/v2/schemas/ rather than hand-written. See
// lib/api/v2/openapi.ts for the generator and its own header comment.
import { NextResponse } from "next/server";
import { openApiDocumentV2 } from "@/lib/api/v2/openapi";

export const dynamic = "force-dynamic";

export const GET = withV2Log(async function GET() {
  return NextResponse.json(openApiDocumentV2());
}, { route: "/api/v2/openapi.json" });
