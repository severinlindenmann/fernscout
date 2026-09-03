import { after } from "next/server";

/**
 * Work that must not be on the response's critical path.
 *
 * **A uniform answer is uniform in the body and in the clock.** B37 made
 * `POST /api/contacts/request` reply with a byte-identical `202` whatever
 * token it was given, so the endpoint could not be used to ask "is that invite
 * still live?". B159 found the question was still answerable, just not from the
 * body: a dead token returned in ~0.2s and a live one in ~1.95s, because a live
 * one did a database insert, issued a code and sent mail before replying. Ten
 * times is not a subtle signal.
 *
 * The fix is not to make the fast branch slower. It is to stop the response
 * waiting for work it never promised to have finished — the endpoint answers
 * `202 accepted`, not `201 created`, and deliberately says nothing about what
 * happened.
 *
 * `after` is Next's primitive for exactly this and is supported on a Node
 * server, which is what this deploys to. It refuses outside a request scope,
 * which is where the fallback comes in: route handlers are called directly by
 * the test suite, and a helper that threw there would mean the timing property
 * could only be tested by standing up a server. Outside a request scope the
 * task simply starts detached and is tracked, so `flushAfterResponse()` can
 * wait for it.
 *
 * A task's failure must never become the caller's. Both paths swallow the
 * error into the log: by the time this runs the response is gone, and the
 * whole point is that the caller learns nothing from what happened next.
 */
const pending = new Set<Promise<void>>();

export function afterResponse(label: string, task: () => Promise<unknown>): void {
  const guarded = async () => {
    try {
      await task();
    } catch (err) {
      console.error(`[${label}] deferred work failed:`, err);
    }
  };

  try {
    after(guarded);
    return;
  } catch {
    // Not in a request scope — a test calling the handler directly, or a
    // script. Fall through and run it here.
  }

  const running = guarded();
  pending.add(running);
  void running.finally(() => pending.delete(running));
}

/**
 * Wait for everything `afterResponse` started outside a request scope.
 *
 * For tests. Inside a request scope Next owns the tasks and this knows nothing
 * about them, which is correct: nothing in a running server should be able to
 * block on another request's deferred work.
 */
export async function flushAfterResponse(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}
