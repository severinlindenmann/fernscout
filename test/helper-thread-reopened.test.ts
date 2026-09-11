import { describe, expect, test } from "vitest";
import { reopenedTurns, type Turn } from "@/lib/helper/thread";

/**
 * B1254 — a reopened conversation used to force-cast every turn to plain
 * text with no trace of a card that was on screen, or of whether pressing
 * it had actually happened. `reopenedTurns` is the pure reconstruction:
 * never a live control, only one of two sentences appended to the turn's
 * own text, decided from the `[proposed: …]`/`[written: …]` notes
 * `proposed()`/`wrote()` already leave in the thread for `model.ts`'s own
 * honesty net.
 */

const say = (key: string, vars?: Record<string, string>) =>
  vars ? `${key}(${Object.values(vars).join(",")})` : key;

function user(text: string): Turn {
  return { role: "user", text };
}
function assistant(text: string): Turn {
  return { role: "assistant", text };
}
function proposedNote(tool: string): Turn {
  return { role: "note", text: `[proposed, not written, waiting to be pressed: ${tool} {}]` };
}
function writtenNote(tool: string): Turn {
  return { role: "note", text: `[written: ${tool} {"trip":"reise"}]` };
}

describe("a proposal never pressed", () => {
  test("reads as pending, naming the kind and asking to say it again", () => {
    const turns: Turn[] = [
      user("start yesterday"),
      assistant("A day for 2026-05-04."),
      proposedNote("start_day"),
    ];
    const result = reopenedTurns(turns, say);
    expect(result).toHaveLength(1);
    expect(result[0].said).toBe("start yesterday");
    expect(result[0].answered).toBe(
      "A day for 2026-05-04.\n\nagent.chat.reopenedPending(agent.card.edit)",
    );
  });
});

describe("a proposal that was pressed", () => {
  test("reads as done, even when the press came after a later sentence", () => {
    const turns: Turn[] = [
      user("throw away that file"),
      assistant("The file waiting in the inbox: photo.jpg."),
      proposedNote("discard_file"),
      user("actually wait"),
      assistant("Sure — say when."),
      user("go ahead"),
      writtenNote("discard_file"),
    ];
    const result = reopenedTurns(turns, say);
    expect(result).toHaveLength(3);
    expect(result[0].answered).toBe(
      "The file waiting in the inbox: photo.jpg.\n\nagent.chat.reopenedDone",
    );
    // Neither of the later turns is touched — the note belongs to the
    // proposal it named, not to whichever turn happened to be open when it
    // landed.
    expect(result[1].answered).toBe("Sure — say when.");
    expect(result[2].answered).toBe("");
  });
});

describe("two proposals of the same tool", () => {
  test("a written note resolves only the proposal still open for that tool", () => {
    const turns: Turn[] = [
      user("start yesterday"),
      assistant("A day for 2026-05-04."),
      proposedNote("start_day"),
      user("no, the 3rd"),
      assistant("A day for 2026-05-03."),
      proposedNote("start_day"),
      writtenNote("start_day"),
    ];
    const result = reopenedTurns(turns, say);
    expect(result).toHaveLength(2);
    // The first ask was superseded by the correction, not pressed itself —
    // it is never resolved, since the written note matches whichever
    // proposal of this tool was still open, and that was the second.
    expect(result[0].answered).toContain("reopenedPending");
    expect(result[1].answered).toContain("reopenedDone");
  });
});

describe("plain text, no proposal at all", () => {
  test("is untouched", () => {
    const turns: Turn[] = [user("how many trips do I have"), assistant("Two.")];
    expect(reopenedTurns(turns, say)).toEqual([{ said: "how many trips do I have", answered: "Two.", origin: undefined }]);
  });
});
