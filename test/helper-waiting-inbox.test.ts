import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { createJournal } from "@/lib/journals";
import { storeInboxFile } from "@/lib/inbox";
import { toVCard } from "@/lib/vcard";
import { describeWaiting, filesForRoom } from "@/lib/helper/server";
import { runTool } from "@/lib/helper/tools";
import type { Say } from "@/lib/helper/intents";
import { writeTripFixture } from "./fixtures/content";
import { WEB_CALLER } from "./support/callers";

/**
 * B1737 — a contact card that was saved and then denied.
 *
 * Live on the operator's journal, 2026-09-14: `handleContactCard` stored a shared card and
 * answered "received — saved, tell me when to invite them", and the next turn
 * said *"I have no access to your contacts"*, twice, about that same file.
 * The card was on disk the whole time; nothing in a turn's context mentioned
 * it, nothing in the files pane drew it, and the owner retyped a name and an
 * address the journal already held.
 */

const OWNER = "waiting1";
const EMAIL = "andreas.brunner@example.test";

const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

let dir: string;

function stageCard(username: string, name: string, email?: string): string {
  const card = toVCard({ name, ...(email ? { emails: [email] } : {}), phones: ["+41760000000"] });
  const stored = storeInboxFile(
    username,
    "contact",
    `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.vcf`,
    Buffer.from(card),
    { source: "whatsapp", receivedAt: "2026-09-14T12:02:25.190Z" },
  );
  return stored.entry.id;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-waiting-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout Test", url: "https://t.test" },
      users: { reserved: [] },
      features: { helper: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  expect(
    createJournal({
      username: OWNER,
      title: "A journal",
      ownerEmail: `${OWNER}@example.test`,
      ownerName: "Owner",
      ownerNickname: "Owner",
      defaultLocale: "en",
    }).ok,
  ).toBe(true);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the line that says what is waiting", () => {
  test("an empty inbox adds nothing at all to a turn", () => {
    expect(describeWaiting(OWNER)).toBe("");
  });

  test("names a staged contact card and its id, and nothing that is inside it", () => {
    stageCard(OWNER, "Andreas Brunner", EMAIL);

    const line = describeWaiting(OWNER);
    expect(line).toContain("andreas-brunner");
    expect(line).toContain("1 contact card(s)");
    // The whole point of reading the card server-side: the address, the phone
    // number and anything else in it never reach a prompt.
    expect(line).not.toContain(EMAIL);
    expect(line).not.toContain("41760000000");
    // And it points at the two tools that can act on it, so the model has
    // somewhere to go rather than denying the card exists.
    expect(line).toContain("invite_contact");
    expect(line).toContain("trip_people");
  });

  test("counts photographs and location pins without naming them", () => {
    storeInboxFile(OWNER, "media", "a.jpg", Buffer.from("not-a-real-jpeg"), {});
    storeInboxFile(OWNER, "location", "pin.json", Buffer.from("{}"), {});

    const line = describeWaiting(OWNER);
    expect(line).toContain("1 photograph(s)");
    expect(line).toContain("1 location pin(s)");
    expect(line).not.toContain("a.jpg");
  });
});

describe("the files pane", () => {
  test("draws a staged contact card, which it used to drop on the floor", () => {
    stageCard(OWNER, "Andreas Brunner", EMAIL);

    const files = filesForRoom(OWNER).inbox;
    expect(files.map((f) => f.kind)).toContain("contact");
    expect(files.find((f) => f.kind === "contact")?.name).toBe("andreas-brunner.vcf");
  });
});

describe("adding a waiting contact to a trip's byline", () => {
  test("trip_people reads the address off the card instead of asking for it again", async () => {
    writeTripFixture(OWNER, {
      id: "elsass",
      title: "Elsass",
      start: "2025-09-01",
      end: "2025-09-07",
      visibility: "private",
    });
    const id = stageCard(OWNER, "Andreas Brunner", EMAIL);

    const ran = await runTool(OWNER, "trip_people", { trip: "Elsass", contact: id }, say, "2026-09-14", [], "", WEB_CALLER);

    // A real proposal, not the needs-an-email refusal — and the address in
    // its field is the card's own, which the owner sees before pressing.
    expect(ran.proposal).toBeTruthy();
    expect(ran.proposal?.arguments.email).toBe(EMAIL);
    expect(ran.proposal?.arguments.person).toBe("Andreas Brunner");
  });

  test("what the writer typed wins over what the card says", async () => {
    writeTripFixture(OWNER, {
      id: "elsass",
      title: "Elsass",
      start: "2025-09-01",
      end: "2025-09-07",
      visibility: "private",
    });
    const id = stageCard(OWNER, "Andreas Brunner", EMAIL);

    const ran = await runTool(
      OWNER,
      "trip_people",
      { trip: "Elsass", contact: id, person: "Andi" },
      say,
      "2026-09-14", [], "", WEB_CALLER
    );
    expect(ran.proposal?.arguments.person).toBe("Andi");
    expect(ran.proposal?.arguments.email).toBe(EMAIL);
  });

  test("a card with no address still refuses, rather than proposing a press that would fail", async () => {
    writeTripFixture(OWNER, {
      id: "elsass",
      title: "Elsass",
      start: "2025-09-01",
      end: "2025-09-07",
      visibility: "private",
    });
    const id = stageCard(OWNER, "No Address");

    const ran = await runTool(OWNER, "trip_people", { trip: "Elsass", contact: id }, say, "2026-09-14", [], "", WEB_CALLER);
    expect(ran.proposal).toBeFalsy();
  });
});
