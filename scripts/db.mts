#!/usr/bin/env tsx
/**
 * Database CLI.
 *
 *   npm run db:migrate               bring the schema up to date
 *   npm run db:status                which migrations have run
 *   npm run db:import                copy $DATA_DIR/*.json into the database
 *   npm run db:import -- --dry-run   say what it would copy, write nothing
 *
 * All of them read DATABASE_URL. The server migrates on boot as well, so this
 * is for looking, for CI, and for running the one-shot JSON import.
 *
 * Written in TypeScript and run through `tsx` so it shares the actual schema
 * and migrations with the app rather than a hand-kept copy of them.
 */
import { Migrator } from "kysely/migration";
import { createDatabase, databaseTarget, migrateToLatest } from "../lib/db";
import { migrationProvider } from "../lib/db/migrations";
import { describeImport, importJsonStores } from "../lib/db/importJson";
import { currentTripRef } from "../lib/trips";
import { getDefaultUsername, getUsernames } from "../lib/users";

const args = process.argv.slice(2);
const command = args[0] ?? "migrate";
const dryRun = args.includes("--dry-run");

const target = databaseTarget();
if (!target) {
  console.error(
    "DATABASE_URL is not set, so there is no database to work on.\n" +
      "For local development:  DATABASE_URL=sqlite: npm run db:migrate",
  );
  process.exit(1);
}

const handle = await createDatabase(target);
console.log(`→ ${target.label}`);

try {
  switch (command) {
    case "migrate": {
      const { results } = await migrateToLatest(handle);
      const ran = results ?? [];
      console.log(
        ran.length === 0
          ? "Already up to date."
          : ran.map((r) => `  ${r.status.toLowerCase()}  ${r.migrationName}`).join("\n"),
      );
      break;
    }

    case "status": {
      const migrator = new Migrator({ db: handle.db, provider: migrationProvider });
      for (const m of await migrator.getMigrations()) {
        console.log(`  ${m.executedAt ? "applied " : "pending "}  ${m.name}`);
      }
      break;
    }

    case "import": {
      // The import needs a schema to import into, and asking someone to
      // remember two commands in the right order is how data gets lost.
      await migrateToLatest(handle);
      const report = await importJsonStores(handle, {
        // Legacy JSON rows carry a bare trip id; qualify it with whoever owns
        // the instance's default trip so the import lands under the right user.
        currentTripId: (() => {
          const owner = getDefaultUsername() ?? getUsernames()[0];
          return (owner && currentTripRef(owner)) || "";
        })(),
        dryRun,
      });
      console.log(describeImport(report));
      if (!dryRun) {
        console.log(
          "\nThe JSON files were left in place. Keep them until you have seen the\n" +
            "site read from the database, then move them somewhere safe.",
        );
      }
      break;
    }

    default:
      console.error(`Unknown command "${command}". Try: migrate | status | import`);
      process.exitCode = 1;
  }
} finally {
  await handle.destroy();
}
