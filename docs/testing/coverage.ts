import type { FeatureName } from "@/lib/config";

/**
 * Which door a flow drives through — see AGENTS.md's own table of "You are /
 * Use". `admin` is the operator's own page, kept separate from `ui` because
 * it authenticates differently (identity cookie vs. owner cookie) and no
 * persona in docs/testing/personas/ plays the operator.
 */
export type Interface = "agent" | "whatsapp" | "api" | "ui" | "admin";

/**
 * One capability's coverage: either the flows that exercise it, or an
 * explicit reason it has none yet. Never both, never neither —
 * test/coverage-contract.test.ts fails on the third case. `todo` exists so
 * that adding a capability with no test yet is a visible, searchable
 * decision rather than a silently missing row (see docs/superpowers/specs/
 * 2026-09-11-managed-instance-testing-framework-design.md, "no silent caps").
 */
export type CoverageEntry =
  | { flows: readonly string[]; interfaces: readonly Interface[] }
  | { todo: string };

/**
 * Filenames under docs/testing/flows/, without the .md extension. Kept as
 * plain strings rather than imported: a flow file has no exported symbol,
 * it is prose a persona-driving session reads.
 */
export const COVERAGE: Record<FeatureName, CoverageEntry> = {
  whatsapp: {
    flows: ["owner-new-onboard-whatsapp"],
    interfaces: ["whatsapp"],
  },
  whatsappInbound: {
    flows: ["owner-new-onboard-whatsapp"],
    interfaces: ["whatsapp"],
  },
  helper: {
    flows: ["buddy-established-add-day-agent"],
    interfaces: ["agent"],
  },
  signup: {
    flows: ["guest-invited-signup-see-update"],
    interfaces: ["ui"],
  },
  contacts: {
    flows: ["guest-invited-signup-see-update"],
    interfaces: ["ui"],
  },
  auth: {
    flows: ["guest-invited-signup-see-update", "buddy-established-add-day-agent"],
    interfaces: ["ui", "agent"],
  },
  reactions: { todo: "no flow yet — B: add when a persona flow needs a reader reaction" },
  costs: { todo: "no flow yet — B: add when a persona flow needs a cost line" },
  push: { todo: "no flow yet — B: add when a persona flow needs a push notification" },
  mail: { todo: "no flow yet — exercised incidentally by every flow that signs in, no dedicated flow" },
  sms: { todo: "no flow yet — B: add when a persona flow signs up by SMS" },
  smsInbound: { todo: "no flow yet — B: add alongside sms above" },
  postcards: { todo: "no flow yet — Stannp has no inbound webhook in production yet, see the backlog ticket this plan filed" },
  photobook: { todo: "no flow yet — B: add a flow once a dry-run photobook order round-trips a fixture" },
  logging: { todo: "operator-only capability, no persona plays the operator yet" },
  credits: { todo: "no flow yet — B: add once a flow needs to spend a credit and check the ledger" },
  addressLookup: { todo: "no flow yet — B: add alongside a postcard-address flow" },
  weather: { todo: "no flow yet — B: add alongside a day-with-weather flow" },
  analytics: { todo: "operator-only capability, no persona plays the operator yet" },
  transcription: { todo: "no flow yet — B: add a voice-note flow once WhatsApp/agent voice input is exercised" },
  fulfilmentRelay: { todo: "operator-only capability, no persona plays the operator yet" },
  fulfilmentAccept: { todo: "operator-only capability, no persona plays the operator yet" },
};
