// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import UploadStep from "@/components/extract/UploadStep";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * The design's "Uploading" screen (S3b) — B1803 Task 3.1. The bar, the
 * `N done` chip and the failure panel are real UI now, not just a badge on
 * each tile. Two things the design draws are deliberately absent and stay
 * that way: a per-tile `62%` badge (a batch has no per-file byte progress a
 * `fetch` can report) and the `iCloud` badge/chip (the File API gives no
 * iCloud-residency signal) — see `UploadStep`'s own module docblock.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function file(name: string): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

async function selectAndSend(files: File[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <UploadStep username="agent" runId="run-1" onDone={() => {}} />
      </LocaleProvider>,
    );
  });
  const input = container.querySelector<HTMLInputElement>("#extract-upload-input")!;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const send = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Upload"))!;
  await act(async () => {
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("a successful attempt", () => {
  test("shows the real done count and never invents an iCloud chip or a per-tile percentage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ rejected: [], stagedBytes: 6 }),
      })) as unknown as typeof fetch,
    );

    await selectAndSend([file("a.jpg"), file("b.jpg")]);

    expect(container!.textContent).toContain("2 done");
    // The design's middle chip ("6 coming from iCloud") and any per-tile
    // percentage badge are both fabricated by construction here — neither
    // signal exists to read. The prose line about iCloud downloads being
    // slow (`extract.upload.icloud`, shown before any upload starts) is a
    // true, unrelated sentence and stays; what must never appear is a chip
    // claiming a number of files are "coming from iCloud".
    expect(container!.textContent).not.toContain("coming from iCloud");
    expect(container!.textContent).not.toMatch(/\d+%/);
  });
});

describe("a failed attempt", () => {
  test("shows the failure panel with a real count, its own explanation and a retry button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    );

    await selectAndSend([file("a.jpg")]);

    expect(container!.textContent).toContain("1 didn't make it");
    expect(container!.textContent).toContain("connection dropped partway");
    const retry = [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry"));
    expect(retry).toBeDefined();
  });
});

describe("the ETA denominator after a batch fails outright", () => {
  test("B1803 fix round 1 — a failed batch's bytes are dropped from the total, not left inflating what's left", async () => {
    // Three batches of ten, ten and one file (BATCH = 10 in UploadStep.tsx).
    // Batch 1 is huge and fails outright; batch 2 is tiny and succeeds;
    // batch 3 is left pending so the chip can be read at the one instant
    // that actually distinguishes the bug from the fix — right after batch
    // 2, before the whole attempt's `finally` clears the chip either way.
    //
    // The arithmetic is deliberately lopsided: if batch 1's 6,000,000 failed
    // bytes are still counted in the denominator, "remaining" is ~6,000,001
    // bytes against a rate set by 10 real bytes — an estimate in the
    // hundreds of thousands of minutes. Dropped correctly, "remaining" is 1
    // byte — an estimate of a single minute (the floor `etaMinutes` never
    // goes below). Any real elapsed time produces the same lopsided ratio,
    // so this needs no mocked clock to be unambiguous.
    const big = () => new File([new Uint8Array(600_000)], "big.jpg");
    const small = () => new File([new Uint8Array(1)], "small.jpg");
    const files = [
      ...Array.from({ length: 10 }, big),
      ...Array.from({ length: 10 }, small),
      small(),
    ];

    let deferredResolve: ((value: unknown) => void) | undefined;
    const thirdBatch = new Promise((resolve) => {
      deferredResolve = resolve;
    });
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          // A real (short) delay, so `Date.now() - startedAt` is
          // unambiguously nonzero by the time batch 2's chip is computed.
          await new Promise((r) => setTimeout(r, 5));
          throw new Error("network down");
        }
        if (call === 2) return { ok: true, json: async () => ({ rejected: [], stagedBytes: 6_000_010 }) };
        await thirdBatch;
        return { ok: true, json: async () => ({ rejected: [], stagedBytes: 6_000_011 }) };
      }) as unknown as typeof fetch,
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <UploadStep username="agent" runId="run-1" onDone={() => {}} />
        </LocaleProvider>,
      );
    });
    const input = container.querySelector<HTMLInputElement>("#extract-upload-input")!;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const send = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Upload"))!;
    await act(async () => {
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // Long enough for batches 1 and 2 to fully settle (batch 1's real
      // 5ms delay included) while batch 3 stays pending on `thirdBatch`.
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(container!.textContent).not.toMatch(/~\d{4,} min left/);
    expect(container!.textContent).toContain("~1 min left");

    deferredResolve?.(undefined);
    await act(async () => {
      await Promise.resolve();
    });
  });
});
