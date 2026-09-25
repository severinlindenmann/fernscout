import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import {
  findInboxFile,
  inboxBytes,
  inboxDir,
  inboxId,
  kindForExtension,
  listInbox,
  removeInboxFile,
  storeInboxFile,
} from "@/lib/inbox";

/**
 * Somewhere to put a file before it belongs to a day — B663.
 *
 * The two properties worth guarding are the two that make the bucket safe to
 * throw files at: **the name is the content**, so a duplicate cannot
 * accumulate and two files sharing a name cannot collide; and **nothing is
 * inferred**, so a sidecar carries what somebody said and no more.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-inbox-"));
  process.env.CONTENT_DIR = dir;
  delete process.env.MEDIA_ORIGINALS_DIR;
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "F", url: "https://e.test", defaultUser: "alex" }, users: {}, features: {} }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      owner: { name: "A B", nickname: "A", email: "a@e.test" },
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the name is the content", () => {
  test("the same bytes under the same name are stored once", () => {
    const bytes = Buffer.from("a photograph, pretend");
    const first = storeInboxFile("alex", "media", "DSC_0001.JPG", bytes, {});
    const second = storeInboxFile("alex", "media", "DSC_0001.JPG", bytes, {});

    expect(second.existed).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(listInbox("alex").media).toHaveLength(1);
    // A retry of a half-finished batch must not double a journal's size.
    expect(inboxBytes("alex")).toBe(bytes.byteLength);
  });

  /** Two cameras produce `IMG_0001.JPG` on the same day about as often as
   * not. Both have to survive. */
  test("two different files sharing a name both survive", () => {
    const a = storeInboxFile("alex", "media", "IMG_0001.jpg", Buffer.from("one"), {});
    const b = storeInboxFile("alex", "media", "IMG_0001.jpg", Buffer.from("two"), {});

    expect(a.entry.id).not.toBe(b.entry.id);
    expect(listInbox("alex").media).toHaveLength(2);
  });

  test("an id is the same on every machine for the same input", () => {
    expect(inboxId("Sunset.JPG", Buffer.from("x"))).toBe(inboxId("sunset.jpg", Buffer.from("x")));
  });

  /** The fallback is the hash, which is already in the name — not the word
   * "entry", which is what `slugify` would have given. */
  test("a name with nothing usable in it still produces an id", () => {
    const id = inboxId("????.jpg", Buffer.from("x"));
    expect(id).toMatch(/^[0-9a-f]{12}\.jpg$/);
  });

  /** The second call said nothing; the first one's description must survive
   * it rather than being quietly cleared. */
  test("a duplicate does not overwrite what was said the first time", () => {
    const bytes = Buffer.from("same");
    storeInboxFile("alex", "media", "a.jpg", bytes, { description: "the ferry at dawn" });
    const again = storeInboxFile("alex", "media", "a.jpg", bytes, {});
    expect(again.entry.description).toBe("the ferry at dawn");
  });
});

describe("the sidecar", () => {
  test("carries what was said, and nothing else", () => {
    const { entry } = storeInboxFile("alex", "media", "a.jpg", Buffer.from("x"), {
      description: "lanterns going up",
      lat: 15.88,
    });

    expect(entry.description).toBe("lanterns going up");
    expect(entry.lat).toBe(15.88);
    // Never invented: a caption nobody wrote is absent, not guessed at.
    expect(entry).not.toHaveProperty("caption");
    expect(entry).not.toHaveProperty("lon");
  });

  test("is written beside the file, with a suffix an upload cannot collide with", () => {
    const { entry } = storeInboxFile("alex", "files", "notes.json", Buffer.from("{}"), {});
    const dirOf = inboxDir("alex", "files");
    expect(fs.existsSync(path.join(dirOf, entry.id))).toBe(true);
    expect(fs.existsSync(path.join(dirOf, `${entry.id}.meta.json`))).toBe(true);
    // The uploaded `.json` is listed as a file, not swallowed as a sidecar.
    expect(listInbox("alex").files).toHaveLength(1);
  });

  /** A sidecar somebody edited by hand must not be able to move its file
   * between folders by claiming a different kind. */
  test("says the folder it is in, not the folder it claims", () => {
    const { entry } = storeInboxFile("alex", "photobook", "cover.png", Buffer.from("x"), {});
    const at = path.join(inboxDir("alex", "photobook"), `${entry.id}.meta.json`);
    fs.writeFileSync(at, JSON.stringify({ ...entry, kind: "media" }));

    expect(listInbox("alex").photobook[0].kind).toBe("photobook");
    expect(listInbox("alex").media).toHaveLength(0);
  });
});

describe("what may come in", () => {
  test.each([
    ["a.jpg", "media"],
    ["a.HEIC", "media"],
    ["a.mp4", "media"],
    ["statement.pdf", "files"],
    ["points.gpx", "files"],
  ])("%s is %s", (name, kind) => {
    expect(kindForExtension(name)).toBe(kind);
  });

  test("a kind of file nothing here takes has no folder", () => {
    expect(kindForExtension("payload.exe")).toBeNull();
    expect(kindForExtension("archive.zip")).toBeNull();
  });
});

describe("taking one out", () => {
  test("a file and its sidecar go together", () => {
    const { entry } = storeInboxFile("alex", "media", "a.jpg", Buffer.from("x"), {});
    expect(removeInboxFile("alex", entry.id)).toBe(true);
    expect(listInbox("alex").media).toHaveLength(0);
    expect(fs.readdirSync(inboxDir("alex", "media"))).toHaveLength(0);
  });

  test("an id that names nothing is said so, not thrown", () => {
    expect(removeInboxFile("alex", "nothing-like-this.jpg")).toBe(false);
  });

  /**
   * An id arrives from a request and is joined into a directory name, which
   * makes it a security boundary in the sense AGENTS.md means. `path.basename`
   * on the way in is the whole guard, and this is what holds it there.
   */
  test("an id cannot climb out of the inbox", () => {
    fs.writeFileSync(path.join(dir, "alex", "config.json.stolen"), "x");
    expect(findInboxFile("alex", "../../config.json.stolen")).toBeNull();
    expect(removeInboxFile("alex", "../../config.json.stolen")).toBe(false);
    expect(fs.existsSync(path.join(dir, "alex", "config.json.stolen"))).toBe(true);
  });
});

describe("finding one", () => {
  test("by id, whichever folder it is in", () => {
    const { entry } = storeInboxFile("alex", "postcards", "art.png", Buffer.from("x"), {});
    const found = findInboxFile("alex", entry.id);
    expect(found?.entry.kind).toBe("postcards");
    expect(fs.readFileSync(found!.file, "utf8")).toBe("x");
  });

  test("a journal with no inbox at all is empty rather than an error", () => {
    expect(listInbox("nobody").media).toEqual([]);
    expect(inboxBytes("nobody")).toBe(0);
  });

  /** A crash between writing the bytes and writing the sidecar leaves a
   * stray. It is not listed — there is nothing true to say about it — and it
   * must not break the listing of everything else. */
  test("a file with no sidecar is skipped, not fatal", () => {
    storeInboxFile("alex", "media", "good.jpg", Buffer.from("x"), {});
    fs.writeFileSync(path.join(inboxDir("alex", "media"), "deadbeef-stray.jpg"), "y");
    expect(listInbox("alex").media).toHaveLength(1);
  });
});
