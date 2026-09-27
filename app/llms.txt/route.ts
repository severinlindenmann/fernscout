import { llmsTxt } from "@/lib/llmsTxt";

/** /llms.txt — B2487. See lib/llmsTxt.ts. Per request: it names the public journals. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(llmsTxt(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
