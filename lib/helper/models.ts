import "server-only";

/**
 * The one place an assistant model id is chosen — B2686.
 *
 * Every call in `lib/helper/model.ts` was pinned to one hard-coded id
 * (`claude-haiku-4-5`), which meant a retirement notice or a model swap was a
 * grep-and-replace across the whole file rather than one changed value, and
 * every call site paid for whichever model happened to be handy rather than
 * the one its job actually needs. Three jobs, one id each:
 *
 * - `small` — a text-only call with a short, bounded answer: polish, the
 *   titles/tags/translate suggestions, reading a receipt or a bank
 *   statement's header, and the thread assistant's own replies.
 * - `vision` — a call that reads a photograph: describing it, or reading who
 *   is in it.
 * - `compose` — the day-composer mode B2688 adds; nothing calls this yet.
 *
 * Each is overridable by its own environment variable, read at call time
 * (not cached in a module-level constant) so a changed value takes effect on
 * the next call rather than the next restart — a retirement notice is not a
 * thing to need a deploy for. The default lives in code, same as every other
 * capability default in this codebase.
 */
export type ModelJob = "small" | "vision" | "compose";

const DEFAULT_MODEL: Record<ModelJob, string> = {
  small: "claude-haiku-4-5",
  vision: "claude-haiku-4-5",
  compose: "claude-sonnet-5",
};

const MODEL_ENV_VAR: Record<ModelJob, string> = {
  small: "ASSISTANT_MODEL_SMALL",
  vision: "ASSISTANT_MODEL_VISION",
  compose: "ASSISTANT_MODEL_COMPOSE",
};

/** The model id a job should call right now — the environment override when
 *  one is set, else the default above. */
export function modelFor(job: ModelJob): string {
  const override = process.env[MODEL_ENV_VAR[job]]?.trim();
  return override ? override : DEFAULT_MODEL[job];
}
