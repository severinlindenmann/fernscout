import { isOwner } from "@/lib/contacts/session";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { cleanupPlan, runCleanup } from "@/lib/storageCleanup";
import { formatBytes } from "@/lib/storageQuota";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Take the generated output off the disk — B664.
 *
 * The other half of a full journal, and the half that costs nothing: photobook
 * PDFs and dry-run postcard sheets are re-buildable from photographs that stay
 * exactly where they are, and the order rows keep their prices and dates. See
 * `lib/storageCleanup.ts` for what is in scope and what is deliberately not.
 *
 * **The owner's own session, and never a token.** It deletes files, and an
 * agent should be reporting that a journal is full rather than deciding which
 * of somebody's files to remove — the same line `POST .../storage` draws for
 * spending credits, and for the same reason.
 *
 * `GET` on it is the plan without the deletion, which is what the confirmation
 * an owner reads is built from.
 */
async function guard(request: Request, user: string): Promise<Response | null> {
  const journal = getUser(user);
  if (!journal) return Response.json({ error: "unknown_user" }, { status: 404 });

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "Cleaning up deletes files and is done by the owner, from their own page. Nothing " +
          "has been deleted. Say what is taking the space and let them decide.",
      },
      { status: 403 },
    );
  }
  if (!(await isOwner(user, request))) {
    return Response.json(
      { error: "forbidden", message: "Only the address that owns this journal may do this." },
      { status: 403 },
    );
  }
  return null;
}

/** `staged=1` includes the documents staged in `inbox/files/`. */
function includesStaged(request: Request): boolean {
  return new URL(request.url).searchParams.get("staged") === "1";
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/storage/cleanup">,
) {
  const { user } = await params;
  const refused = await guard(request, user);
  if (refused) return refused;

  const plan = await cleanupPlan(user, includesStaged(request));
  return Response.json({ ...plan, human: formatBytes(plan.bytes) });
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/storage/cleanup">,
) {
  const { user } = await params;
  const refused = await guard(request, user);
  if (refused) return refused;

  // Owner-only and destructive: a stuck client looping is the thing to stop,
  // and a second press a second later is a mistake rather than an intention.
  const limit = rateLimitFor("storage-cleanup", clientIp(request), { max: 3, windowMs: 60_000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const result = await runCleanup(user, includesStaged(request));
  return Response.json({
    ...result,
    human: formatBytes(result.bytes),
    message:
      `${formatBytes(result.bytes)} across ${result.files} file${result.files === 1 ? "" : "s"} ` +
      "removed. Every photograph, day and order record is untouched — a printed book still says " +
      "it was printed; only its PDF is gone, and it can be built again.",
  });
}
