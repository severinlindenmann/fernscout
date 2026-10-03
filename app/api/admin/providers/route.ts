import { isInstanceAdmin } from "@/lib/adminGate";
import { readProviders } from "@/lib/providers/read";

export const dynamic = "force-dynamic";

/**
 * The Providers section's refresh — B1646. Cookie-only admin, like every route
 * beside it: no bearer path, and the same 404 an unknown route gives. The
 * answer holds figures, states and links; a provider's key never leaves
 * `lib/providers/read.ts`.
 *
 * GET answers from the four-hour cache; POST is the Refresh button and reads
 * the providers again.
 */
async function answer(refresh: boolean) {
  if (!(await isInstanceAdmin())) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(await readProviders({ refresh }), { headers: { "Cache-Control": "no-store" } });
}

export const GET = () => answer(false);
export const POST = () => answer(true);
