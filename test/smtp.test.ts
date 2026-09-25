import { afterEach, describe, expect, test } from "vitest";
import { sendSmtp } from "@/lib/mail/smtp";
import { startFakeSmtp, TEST_CERT, type FakeSmtp } from "./fixtures/smtp-server";

/**
 * The SMTP client, against a socket.
 *
 * `lib/mail/smtp.ts` was left unimplemented for a long time on the grounds
 * that an untested SMTP client is worse than none. These are the tests that
 * retire that argument — every one of them is a mistake the client could
 * plausibly make, and three of them are mistakes it did make while being
 * written.
 */

let server: FakeSmtp | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const MESSAGE = ["From: Fernscout <agent@example.test>", "To: r@example.test", "Subject: Hi", "", "Body."].join("\r\n");

function config(port: number, overrides: Record<string, unknown> = {}) {
  return {
    host: "127.0.0.1",
    port,
    user: "agent@example.test",
    password: "s3cret-token",
    ca: TEST_CERT,
    clientName: "fernscout.test",
    ...overrides,
  };
}

describe("a successful send", () => {
  test("upgrades to TLS, authenticates, and delivers the message", async () => {
    server = await startFakeSmtp();
    const result = await sendSmtp(MESSAGE, {
      from: "agent@example.test",
      to: "r@example.test",
      config: config(server.port),
    });

    const session = server.sessions[0];
    expect(session.upgraded).toBe(true);
    expect(session.mailFrom).toBe("<agent@example.test>");
    expect(session.rcptTo).toEqual(["<r@example.test>"]);
    expect(session.data).toContain("Subject: Hi");
    expect(result.reference).toContain("FAKE123");
  });

  test("greets, upgrades, then greets again — a server's post-TLS capabilities are the real ones", async () => {
    server = await startFakeSmtp();
    await sendSmtp(MESSAGE, {
      from: "agent@example.test",
      to: "r@example.test",
      config: config(server.port),
    });

    const verbs = server.sessions[0].commands.map((c) => c.split(" ")[0].toUpperCase());
    expect(verbs.filter((v) => v === "EHLO")).toHaveLength(2);
    expect(verbs.indexOf("STARTTLS")).toBeGreaterThan(verbs.indexOf("EHLO"));
    expect(verbs.indexOf("AUTH")).toBeGreaterThan(verbs.indexOf("STARTTLS"));
    expect(verbs.at(-1)).toBe("QUIT");
  });

  test("reads a multiline 250 as one reply", async () => {
    // The fake server's EHLO response is four lines. A client that treats the
    // first as the whole reply desynchronises and every later command reads
    // the wrong answer.
    server = await startFakeSmtp();
    await expect(
      sendSmtp(MESSAGE, {
        from: "agent@example.test",
        to: "r@example.test",
        config: config(server.port),
      }),
    ).resolves.toBeDefined();
  });

  test("talks to an implicit-TLS server without STARTTLS", async () => {
    server = await startFakeSmtp({ implicitTls: true, starttls: false });
    await sendSmtp(MESSAGE, {
      from: "agent@example.test",
      to: "r@example.test",
      config: config(server.port, { secure: true }),
    });

    const verbs = server.sessions[0].commands.map((c) => c.split(" ")[0].toUpperCase());
    expect(verbs).not.toContain("STARTTLS");
    expect(verbs).toContain("AUTH");
  });

  test("falls back to AUTH LOGIN when PLAIN is not offered", async () => {
    server = await startFakeSmtp({ authMechanisms: ["LOGIN"] });
    await sendSmtp(MESSAGE, {
      from: "agent@example.test",
      to: "r@example.test",
      config: config(server.port),
    });
    expect(server.sessions[0].commands.some((c) => /^AUTH LOGIN/i.test(c))).toBe(true);
  });
});

describe("the credential never crosses a plaintext socket", () => {
  test("refuses to send when the server offers no STARTTLS", async () => {
    server = await startFakeSmtp({ starttls: false });
    await expect(
      sendSmtp(MESSAGE, {
        from: "agent@example.test",
        to: "r@example.test",
        config: config(server.port),
      }),
    ).rejects.toThrow(/STARTTLS/i);

    // The point of the test: not merely that it failed, but that nothing
    // secret was written before it did.
    const plaintext = server.sessions[0].plaintextCommands.join("\n");
    expect(plaintext).not.toContain("s3cret-token");
    expect(plaintext.toUpperCase()).not.toContain("AUTH");

    // And that it gave up on reading the capability list, rather than trying
    // STARTTLS anyway and relying on the server to say no. A server that is
    // willing to *pretend* is exactly the one this guard exists for.
    expect(plaintext.toUpperCase()).not.toContain("STARTTLS");
  });

  test("a password containing base64-significant bytes still authenticates", async () => {
    server = await startFakeSmtp();
    await sendSmtp(MESSAGE, {
      from: "agent@example.test",
      to: "r@example.test",
      config: config(server.port, { password: "a+b/c=dé" }),
    });
    expect(server.sessions[0].upgraded).toBe(true);
  });
});

describe("the message body", () => {
  test("dot-stuffs a line that begins with a dot", async () => {
    server = await startFakeSmtp();
    const body = ["Subject: T", "", "before", ".hidden line", "after"].join("\r\n");
    await sendSmtp(body, {
      from: "agent@example.test",
      to: "r@example.test",
      config: config(server.port),
    });
    // The server undoes the stuffing, so what it holds must equal what we sent.
    expect(server.sessions[0].data).toContain(".hidden line");
    expect(server.sessions[0].data).not.toContain("..hidden line");
  });

  test("a lone dot on its own line does not truncate the message", async () => {
    server = await startFakeSmtp();
    const body = ["Subject: T", "", "first", ".", "last"].join("\r\n");
    await sendSmtp(body, {
      from: "agent@example.test",
      to: "r@example.test",
      config: config(server.port),
    });
    expect(server.sessions[0].data).toContain("last");
  });

  test("normalises bare newlines to CRLF", async () => {
    server = await startFakeSmtp();
    await sendSmtp("Subject: T\n\nbare\nnewlines\n", {
      from: "agent@example.test",
      to: "r@example.test",
      config: config(server.port),
    });
    expect(server.sessions[0].data).toContain("bare\r\nnewlines");
  });
});

describe("failures are legible", () => {
  test("bad credentials name the step and the code, and never the password", async () => {
    server = await startFakeSmtp({ rejectAuth: true });
    const promise = sendSmtp(MESSAGE, {
      from: "agent@example.test",
      to: "r@example.test",
      config: config(server.port),
    });
    await expect(promise).rejects.toThrow(/535/);
    await expect(promise).rejects.toThrow(/AUTH/i);
    await expect(promise).rejects.not.toThrow(/s3cret-token/);
  });

  test("a rejected recipient reports 550 rather than a generic failure", async () => {
    server = await startFakeSmtp({ rejectRecipient: true });
    await expect(
      sendSmtp(MESSAGE, {
        from: "agent@example.test",
        to: "r@example.test",
        config: config(server.port),
      }),
    ).rejects.toThrow(/550/);
  });

  test("a server that never answers fails on a timeout rather than hanging", async () => {
    server = await startFakeSmtp({ silent: true });
    await expect(
      sendSmtp(MESSAGE, {
        from: "agent@example.test",
        to: "r@example.test",
        config: config(server.port, { timeoutMs: 300 }),
      }),
    ).rejects.toThrow(/timed out/i);
  });

  test("an untrusted certificate is refused by default", async () => {
    server = await startFakeSmtp();
    await expect(
      sendSmtp(MESSAGE, {
        from: "agent@example.test",
        to: "r@example.test",
        // No `ca`: the fixture certificate is self-signed, so a client that
        // verifies properly must reject it.
        config: config(server.port, { ca: undefined }),
      }),
    ).rejects.toThrow(/certificate|self[- ]signed/i);
  });
});
