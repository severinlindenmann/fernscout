/**
 * Subscribes a WhatsApp Business Account (WABA) to this app — the third
 * subscription Meta's Configuration UI never shows, documented as a raw
 * `curl` in `docs/providers/whatsapp.md` until this existed (B1180).
 *
 *   npm run whatsapp:subscribe -- --waba <WABA_ID>
 *
 * A one-shot setup step, run once per WABA, not a scheduled job — so unlike
 * `scripts/rates-refresh.mts` there is no `--dry-run`: a mode that earns its
 * place in something that runs nightly is dead weight in something run once
 * by hand and then never again.
 *
 * **The WABA id is required directly.** `docs/providers/whatsapp.md`
 * documents the manual fallback for finding it from a send-only token
 * (`GET /<PHONE_NUMBER_ID>?fields=health_status`, reading the `entities`
 * array) — auto-resolving it here would add an API call and a failure mode
 * to a script whose whole point is being one shot.
 *
 * **The access token is never printed or logged, in success or in any error
 * path.** Only `WHATSAPP_ACCESS_TOKEN` itself is read from the environment;
 * a missing token is refused outright rather than answered with a dry run.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const GRAPH_VERSION = "v25.0";

export function wabaIdFrom(argv: string[]): string | null {
  const at = argv.indexOf("--waba");
  if (at !== -1) return argv[at + 1] ?? null;
  // A single bare positional argument is accepted too — the natural way to
  // type this by hand.
  const positional = argv.find((a) => !a.startsWith("--"));
  return positional ?? null;
}

async function main(): Promise<number> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    process.stderr.write("WHATSAPP_ACCESS_TOKEN is not set — nothing to authenticate this call with.\n");
    return 1;
  }

  const wabaId = wabaIdFrom(process.argv.slice(2));
  if (!wabaId) {
    process.stderr.write(
      "Usage: npm run whatsapp:subscribe -- --waba <WABA_ID>\n" +
        "No WABA id given. If you only have a phone number id, look the WABA id up first — see\n" +
        "docs/providers/whatsapp.md's \"Finding the WABA id from a send-only token\".\n",
    );
    return 1;
  }

  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    process.stderr.write(`Could not reach graph.facebook.com: ${(err as Error).message}\n`);
    return 1;
  }

  const body = await response.text();
  if (!response.ok) {
    process.stderr.write(`Subscription failed: HTTP ${response.status}\n${body}\n`);
    return 1;
  }

  process.stdout.write(`Subscribed WABA ${wabaId} to this app: ${body}\n`);
  return 0;
}

// Only when run as a program. Importing `wabaIdFrom` from a test must not
// also fire a real network call.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
