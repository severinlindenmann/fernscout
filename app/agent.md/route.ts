import { serverSite } from "@/lib/site";

/**
 * Retired — B311. The 56KB guide this route used to serve is now nine
 * task-sized documents at `/skill/<name>.md`, generated from the same
 * source (`lib/api/skillDocs.ts`, sliced from `lib/api/documentation.ts`'s
 * `agentGuide()`), plus `/documentation.txt`, which stays self-sufficient on
 * its own for signup through a published day (B259).
 *
 * A 301 rather than a 404: every mail, every skill and every other instance's
 * bookmark that still says `/agent.md` lands somewhere true rather than
 * somewhere dead.
 */
export function GET() {
  return Response.redirect(`${serverSite().url}/documentation.txt`, 301);
}
