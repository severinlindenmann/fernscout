/**
 * `spawnSync`'s answer, without `spawnSync`'s price.
 *
 * Every external tool ingest leans on — ffprobe, ffmpeg, the HEIC decoders —
 * used to be run with `spawnSync`, and two of the three callers are HTTP
 * upload routes. A synchronous spawn holds the whole Node process, not just
 * its own request: while one clip transcoded (seconds, on a small VPS, up to
 * the length cap) every other reader of the site waited for it, down to the
 * `/api/health` a load balancer polls. This runs the same process on the
 * event loop instead and resolves with the same shape the callers already
 * read, so the code around each spawn — exit-status checks, stderr in the
 * message, "ENOENT means absent" — did not have to change its reasoning.
 *
 * What is kept on purpose:
 *
 *  - **`timeout` kills with SIGTERM and reports `ETIMEDOUT`**, as `spawnSync`
 *    does, with `status` null. `probe()` in video.ts tells "not installed"
 *    from "not answering" by exactly that code.
 *  - **Output is capped at `maxBuffer` per stream** (the same 1 MiB default).
 *    Past it the child is killed and the result carries `ENOBUFS`, rather than
 *    this process buffering whatever a misbehaving binary cares to write.
 *  - **It never rejects.** A spawn that could not start comes back as `error`
 *    on the result, which is where every caller already looked for it.
 */
import { spawn, type StdioNull, type StdioPipe } from "node:child_process";

export type RunResult = {
  /** Exit code, or null when the process was killed or never started. */
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
  error?: NodeJS.ErrnoException;
};

export type RunOptions = {
  /** stdin is always closed: see `probeVideo` for why an open one hangs. */
  stdout?: "pipe" | "ignore";
  stderr?: "pipe" | "ignore";
  timeout?: number;
  maxBuffer?: number;
};

/** `spawnSync`'s own default, kept so no caller's ceiling moved. */
const DEFAULT_MAX_BUFFER = 1024 * 1024;

function failure(code: string, message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
}

export function runProcess(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const stdio: [StdioNull, StdioPipe | StdioNull, StdioPipe | StdioNull] = [
    "ignore",
    options.stdout ?? "ignore",
    options.stderr ?? "ignore",
  ];
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let error: NodeJS.ErrnoException | undefined;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, stdout: Buffer.concat(out), stderr: Buffer.concat(err), ...(error ? { error } : {}) });
    };

    // `spawn` usually reports a process that cannot start through `error`
    // below, but not always: on macOS a binary for the wrong architecture
    // throws `spawn Unknown system error -86` from the call itself.
    // `spawnSync` returned that as `error` too, and "never rejects" has to
    // cover it.
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio });
    } catch (spawnError) {
      error = spawnError as NodeJS.ErrnoException;
      finish(null);
      return;
    }
    const kill = (reason: NodeJS.ErrnoException) => {
      // The first reason is the one reported: a timeout that then also
      // overflows is still a timeout.
      error ??= reason;
      child.kill("SIGTERM");
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > maxBuffer) return kill(failure("ENOBUFS", `${command}: stdout maxBuffer exceeded`));
      out.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes > maxBuffer) return kill(failure("ENOBUFS", `${command}: stderr maxBuffer exceeded`));
      err.push(chunk);
    });

    if (options.timeout) {
      timer = setTimeout(() => kill(failure("ETIMEDOUT", `${command} ETIMEDOUT`)), options.timeout);
    }

    // ENOENT, EACCES and the failed fork all arrive here, and a process that
    // never started emits no `close` — so this settles on its own.
    child.on("error", (spawnError: NodeJS.ErrnoException) => {
      error ??= spawnError;
      finish(null);
    });
    // `close`, not `exit`: only after it have the pipes finished draining, and
    // the poster frame is the stdout.
    child.on("close", (code) => finish(error ? null : code));
  });
}
