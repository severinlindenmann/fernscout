import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

/**
 * B2262 — a hanging external HEIC decoder is killed and refused, and a
 * decoder whose output has no readable size is refused. One file because
 * `findHeifDecoder` caches its probe per process; the stub's behaviour is
 * chosen per call by a marker file.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-decoder-b2262-"));
const mode = path.join(dir, "mode");
const realPath = process.env.PATH;

beforeAll(() => {
  const stub = path.join(dir, "heif-convert");
  fs.writeFileSync(
    stub,
    `#!/bin/sh\n[ "$1" = "--help" ] && exit 0\n` +
      `if [ "$(cat ${mode})" = hang ]; then exec sleep 60; fi\n` +
      `echo garbage > "$2"\nexit 0\n`,
  );
  fs.chmodSync(stub, 0o755);
  process.env.PATH = `${dir}:${realPath}`;
  process.env.FERNSCOUT_HEIF_TIMEOUT_MS = "300";
});

afterAll(() => {
  process.env.PATH = realPath;
  delete process.env.FERNSCOUT_HEIF_TIMEOUT_MS;
  fs.rmSync(dir, { recursive: true, force: true });
});

// 80x120 HEIC whose HEVC payload sharp cannot decode: the fallback is entered.
const fakeHeic = async () => path.join(process.cwd(), "test/fixtures/ingest/phone.heic");

test("a decoder that hangs is refused within the timeout", async () => {
  const { decodeSource } = await import("@/lib/ingest/image");
  fs.writeFileSync(mode, "hang");
  const started = Date.now();
  await expect(decodeSource(await fakeHeic())).rejects.toThrow(/could not convert/);
  expect(Date.now() - started).toBeLessThan(10_000);
});

test("decoder output with no readable size is refused", async () => {
  const { decodeSource } = await import("@/lib/ingest/image");
  fs.writeFileSync(mode, "garbage");
  await expect(decodeSource(await fakeHeic())).rejects.toThrow(/size could not be read/);
});
