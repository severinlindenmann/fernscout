import { isInstanceAdmin } from "@/lib/adminGate";
import { buildPreview, PREVIEW_LOCALES, type PreviewLocale } from "@/lib/messages/fixtures";
import { TEMPLATES, type TemplateId } from "@/lib/messages/registry";

export const dynamic = "force-dynamic";

/**
 * One template, rendered with sample data — B2441's Preview.
 *
 * Operator-only, the same as every other `/api/admin/**` route: this shows
 * the exact HTML a real recipient would see, and that is not for a bearer
 * token or a stranger to read.
 */
export async function GET(request: Request) {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const template = url.searchParams.get("template") as TemplateId | null;
  const locale = (url.searchParams.get("locale") ?? "en") as PreviewLocale;

  if (!template || !(template in TEMPLATES)) {
    return Response.json({ error: "invalid_request", message: "Unknown template." }, { status: 400 });
  }
  if (!PREVIEW_LOCALES.includes(locale)) {
    return Response.json({ error: "invalid_request", message: "locale must be en, de or hu." }, { status: 400 });
  }

  return Response.json({ preview: buildPreview(template, locale) });
}
