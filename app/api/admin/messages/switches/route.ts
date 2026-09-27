import { isInstanceAdmin } from "@/lib/adminGate";
import { resolveIdentity } from "@/lib/auth/handshake";
import { isSwitchedOff, listSwitches, setSwitch, SwitchRefused } from "@/lib/messages/switches";
import { TEMPLATES, type TemplateId } from "@/lib/messages/registry";

export const dynamic = "force-dynamic";

/** Every switch currently off — the bar at the top of the Messages panel. */
export async function GET() {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ switches: await listSwitches() });
}

/**
 * Turn one key off or back on — B2446. `key` is a flow id, a bare template
 * id, or `"<flowId>/<templateId>"` (a flow's own send node). Refuses a key
 * that names a required template, the same as `setSwitch` itself, so this
 * is a 400 rather than a write that `isSwitchedOff` would then ignore.
 */
export async function POST(request: Request) {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const key = typeof body.key === "string" ? body.key : "";
  const off = body.off === true;
  if (!key) {
    return Response.json({ error: "invalid_request", message: "key is required." }, { status: 400 });
  }

  const identity = await resolveIdentity();
  const updatedBy = identity?.email ?? "operator";

  try {
    await setSwitch(key, off, updatedBy);
  } catch (err) {
    if (err instanceof SwitchRefused) {
      return Response.json({ error: "required", message: err.message }, { status: 400 });
    }
    throw err;
  }

  const templatePart = (key.includes("/") ? key.split("/")[1] : key) as TemplateId;
  const stillOff = templatePart in TEMPLATES ? await isSwitchedOff(templatePart) : off;
  return Response.json({ ok: true, off: stillOff });
}
