import "server-only";
import { skillDoc, type SkillDocSlug } from "./skillDocs";

/** The response every `/skill/<name>.md/route.ts` hands back — see app/agent.md/route.ts for the header note this mirrors. */
export function skillDocResponse(slug: SkillDocSlug): Response {
  return new Response(skillDoc(slug), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
