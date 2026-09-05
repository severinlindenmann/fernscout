import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("@/lib/capabilities", () => ({ isEnabled: vi.fn() }));
vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { photobookEntryFor } from "@/lib/photobook/entry";
import type { Trip } from "@/lib/types";

const TRIP = { username: "alex", id: "asia-2026", ref: "alex/asia-2026" } as Trip;

beforeEach(() => {
  vi.mocked(isEnabled).mockReturnValue(true);
  vi.mocked(isOwner).mockResolvedValue(true);
});

describe("who may order a photobook", () => {
  test("the owner of a journal with photobook and credits on", async () => {
    await expect(photobookEntryFor(TRIP)).resolves.toEqual({
      username: "alex",
      trip: "asia-2026",
    });
  });

  test("nobody, when the reader is not the owner", async () => {
    vi.mocked(isOwner).mockResolvedValue(false);
    await expect(photobookEntryFor(TRIP)).resolves.toBeUndefined();
  });

  test("nobody, when credits are off — a button that cannot be paid for is a lie", async () => {
    vi.mocked(isEnabled).mockImplementation((name: string) => name !== "credits");
    await expect(photobookEntryFor(TRIP)).resolves.toBeUndefined();
  });

  test("nobody, when photobook is off", async () => {
    vi.mocked(isEnabled).mockImplementation((name: string) => name !== "photobook");
    await expect(photobookEntryFor(TRIP)).resolves.toBeUndefined();
  });
});
