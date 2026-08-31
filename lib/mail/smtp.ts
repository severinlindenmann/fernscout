import net from "node:net";
import tls from "node:tls";

/**
 * An SMTP submission client, in the two hundred lines it actually takes.
 *
 * This was deliberately absent for a long time, on the grounds that an
 * untested SMTP client is worse than none. What retires that argument is not a
 * mailbox — it is `test/smtp.test.ts`, which runs this against a real socket
 * and a real TLS upgrade, and asserts the things that go wrong: a multiline
 * greeting read as one reply, a dot at the start of a body line, a credential
 * written before the connection was encrypted.
 *
 * Submission only. This dials a server that will relay for us once we
 * authenticate (decision 17: Proton). It is not an MX client: no DNS lookups,
 * no queue, no retry schedule, one recipient at a time. That is the whole job
 * a journal has, and everything omitted here is something a real MTA does far
 * better.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  /** TLS from the first byte (port 465). Otherwise STARTTLS is required. */
  secure?: boolean;
  /** The name given in EHLO. Servers log it; none of them trust it. */
  clientName?: string;
  /** Extra trust anchor, for a self-hosted server with its own certificate.
   * Unset means the system trust store, which is what production wants. */
  ca?: string;
  /** Applies to each read, not to the session as a whole. */
  timeoutMs?: number;
};

export type SmtpResult = { reference: string };

type Reply = { code: number; lines: string[]; text: string };

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Never let a password reach a log, a journal or an error message.
 *
 * `sendSmtp` throws on failure, and those throws travel: into `journalctl`, up
 * to a 500, into whatever an operator pastes into a chat window. The secret is
 * in this module's scope and nowhere in the strings it builds — this is the
 * function that keeps it that way when a server echoes a command back.
 */
function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("***");
  }
  return out;
}

/**
 * A line-oriented reader over a socket that may be replaced mid-conversation.
 *
 * The socket swap is the whole reason this is a class. After STARTTLS the
 * plaintext socket is wrapped in a `TLSSocket` and every subsequent byte
 * arrives on the new one; anything holding a reference to the old one — a
 * pending read, a buffered chunk — is reading ciphertext.
 */
class SmtpConnection {
  private socket: net.Socket | tls.TLSSocket;
  private buffer = "";
  private lines: string[] = [];
  private waiting?: { resolve: () => void; reject: (err: Error) => void };
  private failure?: Error;
  private readonly timeoutMs: number;

  constructor(socket: net.Socket | tls.TLSSocket, timeoutMs: number) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.attach(socket);
  }

  private attach(socket: net.Socket | tls.TLSSocket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index: number;
      while ((index = this.buffer.indexOf("\r\n")) !== -1) {
        this.lines.push(this.buffer.slice(0, index));
        this.buffer = this.buffer.slice(index + 2);
      }
      if (this.lines.length > 0) this.waiting?.resolve();
    });
    socket.on("error", (err: Error) => this.fail(err));
    socket.on("close", () => this.fail(new Error("the server closed the connection")));
  }

  private fail(err: Error) {
    this.failure ??= err;
    this.waiting?.reject(this.failure);
  }

  /** Swap in the encrypted socket. Called once, immediately after STARTTLS. */
  replaceSocket(socket: tls.TLSSocket) {
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("error");
    this.socket.removeAllListeners("close");
    this.socket = socket;
    this.buffer = "";
    this.lines = [];
    this.failure = undefined;
    this.attach(socket);
  }

  get rawSocket(): net.Socket | tls.TLSSocket {
    return this.socket;
  }

  write(line: string) {
    this.socket.write(line + "\r\n");
  }

  writeRaw(text: string) {
    this.socket.write(text);
  }

  private async nextLine(): Promise<string> {
    if (this.lines.length === 0) {
      if (this.failure) throw this.failure;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiting = undefined;
          reject(new Error(`the mail server timed out after ${this.timeoutMs}ms`));
        }, this.timeoutMs);
        this.waiting = {
          resolve: () => {
            clearTimeout(timer);
            this.waiting = undefined;
            resolve();
          },
          reject: (err) => {
            clearTimeout(timer);
            this.waiting = undefined;
            reject(err);
          },
        };
      });
    }
    return this.lines.shift()!;
  }

  /**
   * One reply, however many lines it spans.
   *
   * `250-FIRST` continues, `250 LAST` ends. Reading only the first line is the
   * classic bug: the conversation stays one reply behind for the rest of the
   * session, and STARTTLS — which is never on the first line — is never seen.
   */
  async readReply(): Promise<Reply> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.nextLine();
      lines.push(line.slice(4));
      if (line.length < 4 || line[3] !== "-") {
        const code = Number.parseInt(line.slice(0, 3), 10);
        return { code, lines, text: lines.join(" ") };
      }
    }
  }

  end() {
    this.socket.removeAllListeners("close");
    this.socket.end();
    this.socket.destroy();
  }
}

/** SNI takes a hostname. An IP literal is not one, and Node is deprecating
 * the leniency that let it through. */
function serverName(host: string): { servername: string } | Record<string, never> {
  return net.isIP(host) === 0 ? { servername: host } : {};
}

function connect(config: SmtpConfig, timeoutMs: number): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      clearTimeout(timer);
      reject(err);
    };
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`connecting to ${config.host}:${config.port} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const socket = config.secure
      ? tls.connect({
          host: config.host,
          port: config.port,
          ...serverName(config.host),
          ...(config.ca ? { ca: config.ca } : {}),
        })
      : net.connect({ host: config.host, port: config.port });

    socket.once(config.secure ? "secureConnect" : "connect", () => {
      clearTimeout(timer);
      socket.removeListener("error", onError);
      resolve(socket);
    });
    socket.once("error", onError);
  });
}

/** Wrap a connected plaintext socket in TLS, verifying the certificate. */
function upgrade(socket: net.Socket, config: SmtpConfig, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the TLS handshake timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    const secure = tls.connect({
      socket,
      ...serverName(config.host),
      ...(config.ca ? { ca: config.ca } : {}),
    });
    secure.once("secureConnect", () => {
      clearTimeout(timer);
      secure.removeAllListeners("error");
      resolve(secure);
    });
    secure.once("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** The bare address a server wants in MAIL FROM / RCPT TO. */
export function envelopeAddress(address: string): string {
  const angled = address.match(/<([^>]+)>/);
  return (angled ? angled[1] : address).trim();
}

/** CRLF everywhere, and no body line may begin with the terminator. */
export function prepareBody(message: string): string {
  const normalised = message.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
  const stuffed = normalised.replace(/^\./gm, "..");
  return stuffed.endsWith("\r\n") ? stuffed : stuffed + "\r\n";
}

function capabilities(reply: Reply): Set<string> {
  return new Set(reply.lines.map((line) => line.trim().toUpperCase()));
}

function authMechanisms(caps: Set<string>): Set<string> {
  for (const line of caps) {
    if (line.startsWith("AUTH ")) {
      return new Set(line.slice(5).split(/\s+/).filter(Boolean));
    }
  }
  return new Set();
}

/** Send one message to one recipient. Resolves with the server's queue id. */
export async function sendSmtp(
  message: string,
  options: { from: string; to: string; config: SmtpConfig },
): Promise<SmtpResult> {
  const { config } = options;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const clientName = config.clientName ?? "localhost";
  const secrets = [config.password];

  const socket = await connect(config, timeoutMs);
  const connection = new SmtpConnection(socket, timeoutMs);

  /** Send a command and insist on the reply code it must produce. */
  const expect = async (step: string, command: string | null, ok: number[]): Promise<Reply> => {
    if (command !== null) connection.write(command);
    const reply = await connection.readReply();
    if (!ok.includes(reply.code)) {
      throw new Error(`${step} failed: ${reply.code} ${redact(reply.text, secrets)}`);
    }
    return reply;
  };

  try {
    await expect("connecting", null, [220]);

    let greeting = await expect("EHLO", `EHLO ${clientName}`, [250]);
    let caps = capabilities(greeting);

    if (!config.secure) {
      if (!caps.has("STARTTLS")) {
        // Deliberately fatal. The alternative is to authenticate in the clear,
        // which hands the mailbox to anyone on the path — and a submission
        // server that cannot do TLS in 2026 is misconfigured, not quaint.
        throw new Error(
          `${config.host}:${config.port} does not offer STARTTLS, and this client will not send ` +
            `credentials over an unencrypted connection. Use port 465 with secure: true, or fix the server.`,
        );
      }
      await expect("STARTTLS", "STARTTLS", [220]);
      const secure = await upgrade(socket as net.Socket, config, timeoutMs);
      connection.replaceSocket(secure);
      // A server's real capabilities are the ones it states over TLS; the
      // plaintext list is advice from an unauthenticated stranger.
      greeting = await expect("EHLO (after STARTTLS)", `EHLO ${clientName}`, [250]);
      caps = capabilities(greeting);
    }

    const mechanisms = authMechanisms(caps);
    if (mechanisms.has("PLAIN")) {
      const token = Buffer.from(`\0${config.user}\0${config.password}`, "utf8").toString("base64");
      await expect("AUTH PLAIN", `AUTH PLAIN ${token}`, [235]);
    } else if (mechanisms.has("LOGIN")) {
      await expect("AUTH LOGIN", "AUTH LOGIN", [334]);
      await expect("AUTH LOGIN (username)", Buffer.from(config.user, "utf8").toString("base64"), [334]);
      await expect("AUTH LOGIN (password)", Buffer.from(config.password, "utf8").toString("base64"), [235]);
    } else {
      throw new Error(
        `${config.host} offers no authentication mechanism this client supports ` +
          `(wanted PLAIN or LOGIN, got: ${[...mechanisms].join(", ") || "none"}).`,
      );
    }

    await expect("MAIL FROM", `MAIL FROM:<${envelopeAddress(options.from)}>`, [250]);
    await expect("RCPT TO", `RCPT TO:<${envelopeAddress(options.to)}>`, [250, 251]);
    await expect("DATA", "DATA", [354]);

    connection.writeRaw(prepareBody(message));
    connection.write(".");
    const queued = await expect("the message body", null, [250]);

    // Best effort: the mail is accepted the moment 250 arrives above, so a
    // server that hangs up rudely on QUIT has still delivered it.
    try {
      connection.write("QUIT");
      await connection.readReply();
    } catch {
      /* already delivered */
    }

    return { reference: redact(queued.text, secrets).trim() };
  } finally {
    connection.end();
  }
}
