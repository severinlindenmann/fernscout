import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn().mockResolvedValue(true) }));
import { POST } from "@/app/[user]/photobook/order/route";
import { GET } from "@/app/[user]/photobooks/[id]/[file]/route";

const params = Promise.resolve({ user: "alex" });

describe("the order route", () => {
  test("a bearer token is refused — an agent never spends credits", async () => {
    const request = new Request("https://example.test/alex/photobook/order", {
      method: "POST",
      headers: { authorization: "Bearer whatever" },
      body: new URLSearchParams({ trip: "alex/asia-2026", orderId: "abc12345", options: "{}" }),
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(403);
  });
});

describe("the download route", () => {
  test("a filename cannot climb out of the order's directory", async () => {
    const response = await GET(new Request("https://example.test/x"), {
      params: Promise.resolve({ user: "alex", id: "abc12345", file: "../../../etc/passwd" }),
    });
    expect(response.status).toBe(404);
  });

  test("only the two shapes of file this feature writes are served", async () => {
    const response = await GET(new Request("https://example.test/x"), {
      params: Promise.resolve({ user: "alex", id: "abc12345", file: "notes.txt" }),
    });
    expect(response.status).toBe(404);
  });
});
