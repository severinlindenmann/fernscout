import { afterEach, describe, expect, test } from "vitest";
import { adopt, forget, history, liveSession, remember, sessionId } from "@/lib/helper/thread";

/**
 * Reopening is resuming — B1168.
 *
 * A conversation reopened from the history panel used to be reading only:
 * the turns were drawn from `helper_sessions`, and the next sentence
 * extended whatever thread happened to be in memory, recorded under *its*
 * id. `adopt()` is the fix, and these are its claims: the adopted session
 * becomes the live one, its turns are what the model would see, the next
 * exchange lands under its id, and adopting the conversation you are
 * already in changes nothing.
 */

const USER = "adopt-test-journal";

afterEach(() => forget(USER));

describe("adopting a stored conversation", () => {
  test("makes it the live one, turns and id together", async () => {
    expect(await liveSession(USER)).toBeNull();
    await adopt(USER, "stored-session-1", [
      { said: "What days are unfinished?", answered: "Two days are waiting." },
      { said: "Tell me about Friday", answered: "Friday is a draft." },
    ]);
    expect(await liveSession(USER)).toBe("stored-session-1");
    expect(await sessionId(USER)).toBe("stored-session-1");
    expect(await history(USER)).toEqual([
      { role: "user", text: "What days are unfinished?" },
      { role: "assistant", text: "Two days are waiting." },
      { role: "user", text: "Tell me about Friday" },
      { role: "assistant", text: "Friday is a draft." },
    ]);
  });

  test("the next exchange is remembered under the adopted id", async () => {
    await adopt(USER, "stored-session-2", [{ said: "hello", answered: "hello back" }]);
    remember(USER, "a new sentence", "a new answer");
    expect(await liveSession(USER)).toBe("stored-session-2");
    expect(await history(USER)).toHaveLength(4);
  });

  test("re-adopting the live conversation is a no-op", async () => {
    await adopt(USER, "stored-session-3", [{ said: "first", answered: "answer" }]);
    remember(USER, "second", "second answer");
    // The page re-renders and adopts again with the *stored* turns, which
    // are staler than the live thread — nothing may be lost to that.
    await adopt(USER, "stored-session-3", [{ said: "first", answered: "answer" }]);
    expect(await history(USER)).toHaveLength(4);
  });

  test("a turn with nothing said or answered contributes nothing", async () => {
    await adopt(USER, "stored-session-4", [{ said: null, answered: "an answer alone" }]);
    expect(await history(USER)).toEqual([{ role: "assistant", text: "an answer alone" }]);
  });

  test("forget ends the adopted conversation like any other", async () => {
    await adopt(USER, "stored-session-5", [{ said: "hi", answered: "hi" }]);
    forget(USER);
    expect(await liveSession(USER)).toBeNull();
  });
});
