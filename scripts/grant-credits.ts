/**
 * The only way credits enter a journal — B366.
 *
 *   npm run credits -- grant <username> <n> ["note"]
 *   npm run credits -- list <username>
 *   npm run credits -- audit [username]
 *
 * `grant` is deliberately not an API route, a server action, or a form, and
 * must never become one: a credit card is downstream of this balance, and a
 * grant path any request could reach is a card any request could spend
 * (`lib/credits.ts`'s "property 1"). This script is the one caller — run by
 * an operator with a shell on the box, after money has actually arrived. If
 * you are about to expose `grant` over HTTP for convenience, don't; add a
 * subcommand here instead.
 *
 * `list` prints one journal's ledger, newest first — there is no
 * reader-facing view of it. `audit` compares `credits.balance` against
 * `SUM(delta)` over the ledger for one journal, or for every known journal
 * when none is named, and is how drift between the two would be noticed.
 *
 * Run through `npm run credits`, not `tsx scripts/grant-credits.ts` directly:
 * `lib/credits.ts` imports `server-only`, which throws unless the
 * `react-server` export condition is active — supplied here by the npm
 * script's `--conditions=react-server` flag (see `scripts/digest.mts` for the
 * same note).
 */
import { auditOwner, creditsEnabled, grant, ledgerFor } from "../lib/credits.ts";
import { closeDatabase } from "../lib/db/index.ts";
import { getUsernames } from "../lib/users.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function usage(): never {
  fail(
    "Usage:\n" +
      '  npm run credits -- grant <username> <n> ["note"]\n' +
      "  npm run credits -- list <username>\n" +
      "  npm run credits -- audit [username]",
  );
}

function requireUser(username: string | undefined): string {
  if (!username) usage();
  if (!getUsernames().includes(username)) {
    fail(`No such user: "${username}". Known users: ${getUsernames().join(", ") || "(none)"}`);
  }
  return username;
}

async function reportAudit(username: string): Promise<boolean> {
  const audit = await auditOwner(username);
  console.log(
    `  ${audit.ok ? "ok  " : "DRIFT"}  ${username}  balance=${audit.balance}  ledger=${audit.ledger}`,
  );
  return audit.ok;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "grant": {
      const [username, nRaw, note] = rest;
      requireUser(username);
      const n = Number(nRaw);
      if (!Number.isInteger(n) || n <= 0) {
        fail(`<n> must be a positive whole number of credits, got "${nRaw}"`);
      }
      await grant(username, n, note);
      // `auditOwner`, not `balanceOf`: the latter answers `null` when the
      // `credits` capability is off, and granting into a server where
      // charging has not been switched on yet is the documented ordinary
      // order of operations (see `grant`'s own doc comment). Reporting
      // "New balance: null" there tells an operator who has just moved money
      // nothing about whether it landed — the stored number is what they
      // need, and whether it is currently being charged against is a
      // separate sentence.
      const { balance } = await auditOwner(username);
      console.log(`Granted ${n} credit(s) to ${username}. New balance: ${balance}.`);
      if (!creditsEnabled()) {
        console.log(
          "Note: the `credits` capability is off on this server, so nothing is being " +
            "charged yet and these credits will not be spent. Switch it on in " +
            "content/config.json when you want sends to start costing.",
        );
      }
      break;
    }

    case "list": {
      const [username] = rest;
      requireUser(username);
      const { balance } = await auditOwner(username);
      const rows = await ledgerFor(username);
      console.log(`${username} — balance ${balance}\n`);
      if (rows.length === 0) console.log("  (no ledger entries)");
      for (const row of rows) {
        const sign = row.delta > 0 ? "+" : "";
        console.log(
          `  ${row.createdAt}  ${sign}${row.delta}  ${row.reason}` +
            `${row.ref ? `  ${row.ref}` : ""}${row.note ? `  (${row.note})` : ""}`,
        );
      }
      break;
    }

    case "audit": {
      const [username] = rest;
      let ok = true;
      if (username) {
        requireUser(username);
        ok = await reportAudit(username);
      } else {
        for (const name of getUsernames()) {
          if (!(await reportAudit(name))) ok = false;
        }
      }
      if (!ok) {
        console.error("\nAt least one journal's balance disagrees with its ledger.");
        process.exitCode = 1;
      }
      break;
    }

    default:
      usage();
  }
}

main()
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
