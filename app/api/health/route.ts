import { NextResponse } from "next/server";
import { resolveCapabilities } from "@/lib/capabilities";
import { FEATURE_NAMES } from "@/lib/config";
import { getUsernames } from "@/lib/users";
import pkg from "@/package.json";

// Never cache or prerender: this reflects the live state of the process
// (env vars, config) at request time, not a build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * `/api/health` — for an uptime monitor, and for the person who deployed this
 * at 2am to see *why* a feature isn't lighting up without grepping env vars.
 *
 * Reports each capability's resolved on/off state and, when off, the reason
 * (`resolveCapabilities()` from lib/capabilities.ts) — never a secret value,
 * only whether one is present. Also reports whether config.json parsed at
 * all, since a broken config is the one failure that can take capability
 * resolution down with it.
 *
 * **Per journal as well as per server.** A capability is a server ceiling and
 * a journal opt-in, and this reported only the ceiling — so `contacts` read
 * "enabled" while `/<user>/contacts` answered 404, because that journal had
 * never switched it on. The person reading this page at 2am concluded the routing
 * was broken. `journals` gives the answer they were actually looking for.
 */
export async function GET() {
  const startedAt = Date.now();

  let capabilities: Record<string, { enabled: boolean; reason?: string }>;
  let configOk = true;
  let configError: string | undefined;

  try {
    const resolved = resolveCapabilities();
    capabilities = {};
    for (const name of FEATURE_NAMES) {
      const state = resolved[name];
      capabilities[name] = state.enabled
        ? { enabled: true }
        : { enabled: false, reason: state.reason };
    }
  } catch (err) {
    // loadConfig() throws ConfigError for a missing/invalid content/config.json.
    // That is a real health problem, not a 500 — report it as unhealthy instead
    // of crashing the health check itself.
    configOk = false;
    configError = err instanceof Error ? err.message : String(err);
    capabilities = {};
  }

  // Only the differences: on a single-user instance, or one where nobody has
  // narrowed anything, this is empty and the server-level block above is the
  // whole truth.
  const journals: Record<string, Record<string, { enabled: boolean; reason?: string }>> = {};
  if (configOk) {
    for (const username of getUsernames()) {
      const resolved = resolveCapabilities(username);
      const narrowed: Record<string, { enabled: boolean; reason?: string }> = {};
      for (const name of FEATURE_NAMES) {
        const state = resolved[name];
        if (state.enabled === capabilities[name].enabled) continue;
        narrowed[name] = state.enabled
          ? { enabled: true }
          : { enabled: false, reason: state.reason };
      }
      if (Object.keys(narrowed).length > 0) journals[username] = narrowed;
    }
  }

  const body = {
    status: configOk ? "ok" : "error",
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    version: pkg.version ?? null,
    commit: process.env.GIT_SHA ?? null,
    config: configOk ? { ok: true } : { ok: false, error: configError },
    capabilities,
    journals,
    responseTimeMs: Date.now() - startedAt,
  };

  return NextResponse.json(body, {
    status: configOk ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
