import { describe, expect, test } from "vitest";
import { buddyPrompt, handoverPrompt } from "@/lib/api/agentCopy";

/**
 * The two prompts an owner pastes into an agent — B1765.
 *
 * Neither had a test before this, which is how both of the things asserted
 * here went missing in the first place. They are copy addressed to a machine,
 * so the failure mode is not a typo somebody spots on the page: it is an agent
 * quietly doing the wrong thing, days later, on somebody's journal.
 */

const OWNER_PROMPT = handoverPrompt({
  siteUrl: "https://example.test",
  username: "cleo",
  handover: "fs_handover_EXAMPLE",
  minutes: 20,
});

const BUDDY_PROMPT = buddyPrompt({
  siteUrl: "https://example.test",
  username: "cleo",
  tripId: "alps-2024",
  email: "buddy@example.test",
});

describe("the owner's handover prompt", () => {
  /**
   * The prompt used to give step 1 as a complete curl and step 2 as a bare
   * `GET <url>`, and nothing in the chain — not here, not the `next` line the
   * exchange answers with — ever said the 7-day token travels in a header.
   * An agent that guessed wrong got a 401 and read it as a bad token.
   */
  test("shows the status call carrying its bearer header", () => {
    expect(OWNER_PROMPT).toContain("https://example.test/api/v2/cleo/status");
    const status = OWNER_PROMPT.split("\n").findIndex((line) => line.includes("/api/v2/cleo/status"));
    expect(status).toBeGreaterThan(-1);
    // The header is the line under the URL, not somewhere else in the prompt.
    expect(OWNER_PROMPT.split("\n")[status + 1]).toContain("Authorization: Bearer");
  });

  test("names the key it is handing over, and how long it lasts", () => {
    expect(OWNER_PROMPT).toContain("fs_handover_EXAMPLE");
    expect(OWNER_PROMPT).toContain("20 minutes");
  });
});

describe("both prompts", () => {
  /**
   * B293 was an agent that met "no correct call available and nothing saying
   * so" and invented a web UI. B1756 was an agent that met a 500 with an empty
   * body and concluded the endpoint had been removed. Both went looking for
   * another door rather than reporting what they got, and there is no other
   * door — so both prompts say so.
   */
  test.each([
    ["owner", OWNER_PROMPT],
    ["buddy", BUDDY_PROMPT],
  ])("tell a %s agent to report a failed call rather than route around it", (_who, prompt) => {
    expect(prompt).toContain("If a call fails, tell me what it answered and stop.");
    expect(prompt).toContain("Do not look for");
  });

  /**
   * English regardless of the owner's locale — the reader is a machine, and
   * every other agent-facing document on this instance is English. The
   * function takes no locale for exactly this reason; this is the assertion
   * that stops one being threaded in later without the argument being had.
   */
  test.each([
    ["owner", OWNER_PROMPT],
    ["buddy", BUDDY_PROMPT],
  ])("say that a %s agent's writing arrives as a draft", (_who, prompt) => {
    expect(prompt.toLowerCase()).toContain("draft");
  });
});
