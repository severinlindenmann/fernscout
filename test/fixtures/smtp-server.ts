import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * A real SMTP server, small enough to read, that speaks the parts of RFC 5321
 * this project uses.
 *
 * It exists so the client can be tested against a socket rather than a mock:
 * the bugs an SMTP client actually has — a multiline greeting parsed as one
 * reply, credentials sent before the TLS upgrade, a body line beginning with a
 * dot swallowed by the server — are all bugs in how it reads and writes the
 * wire, and a mock of the wire cannot have them.
 *
 * The certificate is self-signed and **generated on first use**, into a temp
 * directory, rather than committed. `.gitignore` excludes `*.pem` on purpose —
 * a rule worth more than the half-second this costs — and a private key in a
 * repository is a thing people learn to scroll past, which is how a real one
 * eventually joins it. It is trusted only by tests that pass it in as `ca`.
 */

const CERT_DIR = path.join(os.tmpdir(), "fernscout-smtp-fixture");

function ensureCertificate(): { cert: string; key: string } {
  const certFile = path.join(CERT_DIR, "cert.pem");
  const keyFile = path.join(CERT_DIR, "key.pem");
  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    try {
      execFileSync(
        "openssl",
        [
          "req", "-x509", "-newkey", "rsa:2048",
          "-keyout", keyFile, "-out", certFile,
          "-days", "3650", "-nodes",
          "-subj", "/CN=localhost",
          "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
        ],
        { stdio: "pipe" },
      );
    } catch (err) {
      throw new Error(
        "The SMTP tests need a throwaway TLS certificate and could not run openssl to make one. " +
          "Install openssl, or skip test/smtp.test.ts knowingly — but do not delete it: " +
          "it is the only thing standing between this project and an untested SMTP client.\n" +
          String(err),
      );
    }
  }
  return { cert: fs.readFileSync(certFile, "utf8"), key: fs.readFileSync(keyFile, "utf8") };
}

const { cert: TEST_CERT_PEM, key: TEST_KEY } = ensureCertificate();
export const TEST_CERT = TEST_CERT_PEM;

export type Session = {
  /** Every command line the server received, in order. `AUTH` payloads
   * included — a test asserting a secret never crossed a plaintext socket has
   * to be able to look. */
  commands: string[];
  /** Commands seen before the connection was upgraded to TLS. */
  plaintextCommands: string[];
  /** The message body, after the server undid dot-stuffing. */
  data?: string;
  mailFrom?: string;
  rcptTo: string[];
  upgraded: boolean;
};

export type FakeSmtpOptions = {
  /** Advertise STARTTLS in the EHLO response. */
  starttls?: boolean;
  /** Advertise these AUTH mechanisms. Empty means the extension is absent. */
  authMechanisms?: string[];
  /** Reject AUTH with 535, whatever the credentials. */
  rejectAuth?: boolean;
  /** Reject RCPT TO with 550. */
  rejectRecipient?: boolean;
  /** Accept the connection and then say nothing at all, so the client's
   * read timeout is the only thing that can end it. */
  silent?: boolean;
  /** Serve TLS from the first byte (port 465 style) rather than STARTTLS. */
  implicitTls?: boolean;
};

export type FakeSmtp = {
  port: number;
  sessions: Session[];
  close(): Promise<void>;
};

/** Start a server on an ephemeral port. Always close it in `afterEach`. */
export async function startFakeSmtp(options: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const {
    starttls = true,
    authMechanisms = ["PLAIN", "LOGIN"],
    rejectAuth = false,
    rejectRecipient = false,
    silent = false,
    implicitTls = false,
  } = options;

  const sessions: Session[] = [];

  const handle = (socket: net.Socket | tls.TLSSocket, session: Session) => {
    let buffer = "";
    let inData = false;
    let dataLines: string[] = [];
    let authAwaiting: "username" | "password" | null = null;

    const write = (line: string) => socket.write(line + "\r\n");

    const ehlo = () => {
      const lines = ["250-fake.test greets you"];
      if (starttls && !session.upgraded) lines.push("250-STARTTLS");
      if (authMechanisms.length > 0) lines.push(`250-AUTH ${authMechanisms.join(" ")}`);
      lines.push("250 SIZE 35882577");
      // The last line uses a space, every earlier one a hyphen. A client that
      // stops at the first line never sees STARTTLS.
      socket.write(lines.join("\r\n") + "\r\n");
    };

    const onLine = (line: string) => {
      if (inData) {
        if (line === ".") {
          inData = false;
          // Undo dot-stuffing exactly as a real server must.
          session.data = dataLines.map((l) => (l.startsWith("..") ? l.slice(1) : l)).join("\r\n");
          dataLines = [];
          write("250 2.0.0 Ok: queued as FAKE123");
          return;
        }
        dataLines.push(line);
        return;
      }

      session.commands.push(line);
      if (!session.upgraded) session.plaintextCommands.push(line);

      if (authAwaiting) {
        // AUTH LOGIN's two continuation lines are bare base64, not commands.
        authAwaiting = authAwaiting === "username" ? "password" : null;
        if (authAwaiting) return write("334 UGFzc3dvcmQ6");
        return write(rejectAuth ? "535 5.7.8 Authentication credentials invalid" : "235 2.7.0 Accepted");
      }

      const [verb, ...rest] = line.split(" ");
      const upper = verb.toUpperCase();
      const argument = rest.join(" ");

      if (upper === "EHLO" || upper === "HELO") return ehlo();

      if (upper === "STARTTLS") {
        if (!starttls) return write("500 5.5.1 Unrecognized command");
        write("220 2.0.0 Ready to start TLS");
        const upgraded = new tls.TLSSocket(socket, {
          isServer: true,
          cert: TEST_CERT,
          key: TEST_KEY,
        });
        session.upgraded = true;
        // Re-enter with a fresh parser: the old socket's buffered bytes are
        // ciphertext from here on.
        handle(upgraded, session);
        return;
      }

      if (upper === "AUTH") {
        const [mechanism, initial] = argument.split(" ");
        if (mechanism.toUpperCase() === "PLAIN") {
          if (!initial) return write("334 ");
          return write(rejectAuth ? "535 5.7.8 Authentication credentials invalid" : "235 2.7.0 Accepted");
        }
        if (mechanism.toUpperCase() === "LOGIN") {
          authAwaiting = "username";
          return write("334 VXNlcm5hbWU6");
        }
        return write("504 5.5.4 Unrecognized authentication type");
      }

      if (upper === "MAIL") {
        session.mailFrom = argument.replace(/^FROM:/i, "").trim();
        return write("250 2.1.0 Ok");
      }
      if (upper === "RCPT") {
        if (rejectRecipient) return write("550 5.1.1 No such user here");
        session.rcptTo.push(argument.replace(/^TO:/i, "").trim());
        return write("250 2.1.5 Ok");
      }
      if (upper === "DATA") {
        inData = true;
        return write("354 End data with <CR><LF>.<CR><LF>");
      }
      if (upper === "QUIT") {
        write("221 2.0.0 Bye");
        socket.end();
        return;
      }
      write("500 5.5.1 Unrecognized command");
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        onLine(line);
      }
    });
    socket.on("error", () => {});
  };

  const onConnection = (socket: net.Socket | tls.TLSSocket) => {
    const session: Session = {
      commands: [],
      plaintextCommands: [],
      rcptTo: [],
      upgraded: implicitTls,
    };
    sessions.push(session);
    socket.on("error", () => {});
    if (silent) return;
    socket.write("220 fake.test ESMTP ready\r\n");
    handle(socket, session);
  };

  const server = implicitTls
    ? tls.createServer({ cert: TEST_CERT, key: TEST_KEY }, onConnection)
    : net.createServer(onConnection);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no port");

  return {
    port: address.port,
    sessions,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
