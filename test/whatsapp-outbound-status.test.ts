import { describe, expect, test } from "vitest";
import { parseOutboundStatuses } from "@/lib/whatsapp/inbound";

/**
 * B1809 — a send Meta accepted and then refused is the only place the reason
 * ever appears, and the route discarded it. These cover the shape, not the
 * logging.
 */

function delivery(statuses: unknown[]): unknown {
  return { entry: [{ changes: [{ value: { statuses } }] }] };
}

describe("parseOutboundStatuses", () => {
  test("a failed status carries Meta's own code and title", () => {
    const out = parseOutboundStatuses(
      delivery([
        {
          id: "wamid.ABC",
          status: "failed",
          recipient_id: "41765613150",
          errors: [{ code: 131049, title: "Message not delivered to maintain engagement" }],
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      wamid: "wamid.ABC",
      status: "failed",
      recipient: "41765613150",
      errorCode: 131049,
      errorTitle: "Message not delivered to maintain engagement",
    });
  });

  test("a delivered status parses with no error fields", () => {
    const out = parseOutboundStatuses(
      delivery([{ id: "wamid.OK", status: "delivered", recipient_id: "41765613150" }]),
    );
    expect(out[0].status).toBe("delivered");
    expect(out[0].errorCode).toBeUndefined();
  });

  test("a failed status with no errors array still parses, so the log says so rather than throwing", () => {
    const out = parseOutboundStatuses(delivery([{ id: "wamid.X", status: "failed", recipient_id: "41765613150" }]));
    expect(out[0].errorCode).toBeUndefined();
  });

  test("an inbound-only delivery yields no statuses", () => {
    const out = parseOutboundStatuses({ entry: [{ changes: [{ value: { messages: [{ id: "a", from: "b" }] } }] }] });
    expect(out).toEqual([]);
  });

  test("junk in the statuses array is skipped rather than thrown on", () => {
    const out = parseOutboundStatuses(delivery([null, 7, {}, { id: "wamid.Y", status: "read", recipient_id: "x" }]));
    expect(out).toHaveLength(1);
    expect(out[0].wamid).toBe("wamid.Y");
  });
});
