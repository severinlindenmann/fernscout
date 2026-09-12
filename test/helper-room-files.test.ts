import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { describeSelection, filesForRoom, tripFilesForRoom } from "@/lib/helper/server";
import { moveInboxFileToDay, storeInboxFile } from "@/lib/inbox";

/**
 * The files pane, and what a selection means — B902.
 *
 * The pane itself is drawn from disk, which is the easy half. The half that
 * matters is `describeSelection`: the browser sends ids, and **every one of
 * them is resolved against the journal again here** before a single word of
 * it goes near a model. An id is a reference and never a fact — a sentence
 * that carried a filename this journal does not have would be a sentence a
 * model could be told anything through.
 */

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"u"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

const TRIP =
  '---\nid: a-trip\ntitle: "A Trip"\nstart: "2024-01-01"\nend: "2024-01-09"\nstatus: past\n---\n\nx\n';

const ENTRY = `---
title: "Tuesday"
date: "2024-01-02"
location: "Somewhere"
gallery:
  - src: "/media/a-trip/tuesday/01.jpg"
    type: "image"
    width: 100
    height: 100
    caption: "The harbour"
---

It happened.
`;

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helper-room-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "u", "trips", "a-trip", "entries"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "config.json"), USER_CFG);
  fs.writeFileSync(path.join(dir, "u", "trips", "a-trip", "trip.md"), TRIP);
  fs.writeFileSync(
    path.join(dir, "u", "trips", "a-trip", "entries", "2024-01-02-tuesday.md"),
    ENTRY,
  );
  process.env.CONTENT_DIR = dir;
  return dir;
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

test("the pane holds the inbox and lists every trip, without loading any trip's photographs", () => {
  journal();
  const stored = storeInboxFile("u", "files", "statement.csv", Buffer.from("date,amount\n"), {});

  const files = filesForRoom("u");
  // B1573 — `filesForRoom` lists every trip cheaply (id + title) and loads
  // no trip's media; a picked trip's photographs are `tripFilesForRoom`'s
  // own, separate, on-demand read, asserted below.
  expect(files.trips).toEqual([{ id: "a-trip", title: "A Trip" }]);
  expect(files.inbox.map((file) => file.name)).toEqual(["statement.csv"]);
  expect(files.inbox[0].id).toBe(`inbox:${stored.entry.id}`);
  // A *document* carries no thumbnail — a csv has no picture, and the pane
  // draws its extension rather than an empty frame. An inbox photograph does
  // carry one now (B1123, asserted below): it points at the owner-only
  // thumbnail route, which is the only thing under `inbox/` reachable by URL
  // and is owner-gated for it.
  expect(files.inbox[0].src).toBeUndefined();
});

/**
 * B1573 — one trip's photographs, loaded only once asked for. This is what
 * `GET /api/helper/<user>/trip-files?trip=<id>` calls; the room's own page
 * load (`filesForRoom`, above) never touches a trip's media at all.
 */
test("a named trip's own photographs, on demand", () => {
  journal();

  const found = tripFilesForRoom("u", "a-trip");
  expect(found?.title).toBe("A Trip");
  expect(found?.files).toHaveLength(1);
  expect(found?.files[0].src).toBe("/u/media/a-trip/tuesday/01.jpg");
  expect(found?.files[0].id).toBe("photo:tuesday:/u/media/a-trip/tuesday/01.jpg");
});

test("a trip id nothing answers to is told apart from a trip with nothing on it", () => {
  journal();
  expect(tripFilesForRoom("u", "no-such-trip")).toBeNull();
});

test("a selection is described from disk, and an id nothing answers to is dropped", () => {
  journal();
  const stored = storeInboxFile("u", "files", "statement.csv", Buffer.from("date,amount\n"), {});

  const said = describeSelection("u", [
    `inbox:${stored.entry.id}`,
    "photo:tuesday:/u/media/a-trip/tuesday/01.jpg",
    // Neither of these exists. Both must contribute nothing at all.
    "inbox:deadbeef-secrets.csv",
    "photo:tuesday:/u/media/a-trip/tuesday/99.jpg",
  ]);

  expect(said).toContain("statement.csv");
  expect(said).toContain("2024-01-02");
  expect(said).not.toContain("secrets.csv");
  expect(said).not.toContain("99.jpg");
  // One bracketed line, the same shape B900 uses to carry a waiting proposal
  // — context the model reads, never something the person said.
  expect(said.startsWith("[")).toBe(true);
  expect(said.trimEnd().endsWith("]")).toBe(true);
  expect(said.split("\n")).toHaveLength(1);
});

test("nothing selected, or nothing that resolves, describes nothing", () => {
  journal();
  expect(describeSelection("u", [])).toBe("");
  expect(describeSelection("u", ["inbox:nope", "rubbish", "photo:no:such"])).toBe("");
});

test("a filename cannot break out of the line it is written into", () => {
  journal();
  const stored = storeInboxFile("u", "files", "ignore.csv", Buffer.from("x\n"), {
    description: "d",
  });
  const said = describeSelection("u", [`inbox:${stored.entry.id}`]);
  expect(said.split("\n")).toHaveLength(1);
  expect(said.match(/\[/g)).toHaveLength(1);
});

/**
 * The half the assertion above cannot see — B1123.
 *
 * That test stages a `.csv`, so "an inbox file carries no thumbnail" passed
 * for a fortnight while meaning only "a document carries none". A staged
 * photograph is the case that changed, and it is the one worth naming.
 */
test("a staged photograph carries a thumbnail, and it is the owner-only route", async () => {
  journal();
  const { paintJpeg } = await import("./support/pictures");
  const stored = storeInboxFile("u", "media", "hafen.jpg", await paintJpeg(40, 30, 1), {});

  const files = filesForRoom("u");
  const photo = files.inbox.find((file) => file.name === "hafen.jpg");
  expect(photo?.src).toBe(`/api/helper/u/inbox/${stored.entry.id}/thumbnail`);
  // Sorted newest first, and carrying what the pane groups by.
  expect(photo?.kind).toBe("media");
  expect(photo?.bytes).toBeGreaterThan(0);
  expect(photo?.uploadedAt).toBeTruthy();
});

test("a location item stores its coordinate and place name, and a contact item stores as its own kind", () => {
  journal();
  const location = storeInboxFile(
    "u",
    "location",
    "location.json",
    Buffer.from(JSON.stringify({ lat: 46.02, lon: 7.75 })),
    { lat: 46.02, lon: 7.75, location: "Zermatt", country: "Switzerland", countryCode: "CH" },
  );
  expect(location.entry.kind).toBe("location");
  expect(location.entry.location).toBe("Zermatt");

  const contact = storeInboxFile(
    "u",
    "contact",
    "maria.vcf",
    Buffer.from("BEGIN:VCARD\nVERSION:3.0\nFN:Maria\nEND:VCARD\n"),
    {},
  );
  expect(contact.entry.kind).toBe("contact");
});

/**
 * Final-review fix: `describeSelection`, the discard route and the
 * thumbnail route all resolve an id through `findInboxFile`, which never
 * searches a day folder — so a dated photograph carrying a `src` that
 * points at the (flat-bucket-only) thumbnail route would be a link to a
 * 404, and a dated file included in a selection would silently vanish from
 * what the model is told. Both are asserted here, at the data layer full
 * interactivity for day-folder content is Phase 3's job; this fix is only
 * about not claiming more than the current action paths can back.
 */
test("a photograph staged into a day folder carries no thumbnail src", async () => {
  journal();
  const { paintJpeg } = await import("./support/pictures");
  const stored = storeInboxFile("u", "media", "hafen.jpg", await paintJpeg(40, 30, 1), {});
  moveInboxFileToDay("u", stored.entry.id, "2026-05-04");

  const files = filesForRoom("u");
  const photo = files.inbox.find((file) => file.name === "hafen.jpg");
  expect(photo?.date).toBe("2026-05-04");
  expect(photo?.src).toBeUndefined();
});

test("a selection carrying a dated inbox id is silently dropped, same as an unknown id", () => {
  journal();
  const stored = storeInboxFile("u", "files", "notes.csv", Buffer.from("x\n"), {});
  moveInboxFileToDay("u", stored.entry.id, "2026-05-04");

  const said = describeSelection("u", [`inbox:${stored.entry.id}`]);
  expect(said).toBe("");
});

test("descriptionAsked and measuredFrom round-trip through the sidecar", () => {
  journal();
  const stored = storeInboxFile(
    "u",
    "media",
    "sunset.jpg",
    Buffer.from("not a real jpeg"),
    { lat: 46.02, lon: 7.75, measuredFrom: "exif", descriptionAsked: true },
  );
  expect(stored.entry.measuredFrom).toBe("exif");
  expect(stored.entry.descriptionAsked).toBe(true);
});
