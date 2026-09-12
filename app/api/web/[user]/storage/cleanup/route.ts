// Take the generated output off the disk — B1622, phase 2 step 4 (money.md
// §2.6), moved unchanged from app/api/v1/[user]/storage/cleanup/route.ts.
// Owner's own session only, never a token — the same line
// .../storage/purchases draws for spending credits, for the same reason.
import { isOwner } from "@/lib/contacts/session";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { cleanupPlan, runCleanup } from "@/lib/storageCleanup";
import { formatBytes } from "@/lib/storageQuota";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

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

function includesStaged(request: Request): boolean {
  return new URL(request.url).searchParams.get("staged") === "1";
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/storage/cleanup">,
) {
  const { user } = await params;
  const refused = await guard(request, user);
  if (refused) return refused;

  const plan = await cleanupPlan(user, includesStaged(request));
  return Response.json({ ...plan, human: formatBytes(plan.bytes) });
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/storage/cleanup">,
) {
  const { user } = await params;
  const refused = await guard(request, user);
  if (refused) return refused;

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
