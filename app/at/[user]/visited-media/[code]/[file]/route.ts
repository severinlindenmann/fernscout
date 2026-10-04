import fs from "node:fs";
import { mediaDerivative } from "@/lib/media";
import { parseWidth } from "@/lib/mediaSizes";
import { getUser } from "@/lib/users";
import { visibleVisit, visitPhotoFile, visitReader } from "@/lib/visited";

export const dynamic = "force-dynamic";

/**
 * Serves the one photograph of a country visited without a trip — B2914.
 *
 * Gated by the entry's own visibility through `visibleVisit`, which applies
 * the same predicates trips use (`lib/access.ts`), and only ever the file the
 * entry names right now. Every refusal is a 404, as on the trip media route:
 * a 403 would confirm the entry is there. Never `public` in a shared cache
 * unless the entry is.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/at/[user]/visited-media/[code]/[file]">,
) {
  const { user, code, file } = await params;
  const notFound = () => new Response("Not found", { status: 404 });
  if (!getUser(user)) return notFound();

  const entry = visibleVisit(user, code.toUpperCase(), await visitReader(user));
  const full = entry && visitPhotoFile(user, entry, file);
  if (!entry || !full) return notFound();

  const width = parseWidth(new URL(request.url).searchParams.get("w"));
  const sized = width ? await mediaDerivative(full, width) : null;
  let body: Uint8Array;
  let type = "image/jpeg";
  if (sized) {
    type = "image/webp";
    if ("bytes" in sized) body = new Uint8Array(sized.bytes);
    else {
      try {
        body = new Uint8Array(sized.size);
        await sized.handle.read(body, 0, sized.size, 0);
      } finally {
        await sized.handle.close().catch(() => {});
      }
    }
  } else {
    body = new Uint8Array(fs.readFileSync(full));
  }

  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(body.byteLength),
      "Cache-Control": `${entry.visibility === "public" ? "public" : "private"}, max-age=3600`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
