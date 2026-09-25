import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

/**
 * B2205 — the external HEIC decoder is never run on a file whose size sharp
 * cannot read. With no declared width and height there is nothing to bound
 * it by, and it would decode whatever the file claims.
 *
 * A file of its own for the reason `test/ingest-decode-mismatch.test.ts`
 * gives: `findHeifDecoder` caches its probe per process, so the stub has to
 * be on `PATH` before anything imports the decoder.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-decoder-unknown-"));
const ran = path.join(dir, "ran");
const realPath = process.env.PATH;

beforeAll(() => {
  const stub = path.join(dir, "heif-convert");
  fs.writeFileSync(stub, `#!/bin/sh\n[ "$1" = "--help" ] && exit 0\ntouch ${ran}\nexit 1\n`);
  fs.chmodSync(stub, 0o755);
  process.env.PATH = `${dir}:${realPath}`;
});

afterAll(() => {
  process.env.PATH = realPath;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a file with no readable size is refused before the decoder runs", async () => {
  const { decodeSource } = await import("@/lib/ingest/image");
  const file = path.join(dir, "mystery.heic");
  fs.writeFileSync(file, Buffer.from("not a picture sharp can read a header of"));

  await expect(decodeSource(file)).rejects.toThrow(/size could not be read/);
  expect(fs.existsSync(ran)).toBe(false);
});
