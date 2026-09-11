import type { FeatureName } from "@/lib/config";

/**
 * Which door a flow drives through — see AGENTS.md's own table of "You are /
 * Use". `admin` is the operator's own page, kept separate from `ui` because
 * it authenticates differently (identity cookie vs. owner cookie) —
 * docs/testing/personas/operator.md is the one persona that plays it.
 */
type Interface = "agent" | "whatsapp" | "api" | "ui" | "admin";

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
    flows: ["owner-established-use-agent-helper"],
    interfaces: ["ui"],
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
    interfaces: ["ui", "api"],
  },
  reactions: {
    flows: ["guest-established-react-to-day"],
    interfaces: ["ui"],
  },
  costs: {
    flows: ["owner-established-add-cost-line"],
    interfaces: ["api"],
  },
  push: {
    flows: ["guest-established-push-notification"],
    interfaces: ["ui"],
  },
  mail: { todo: "no flow yet — exercised incidentally by every flow that signs in, no dedicated flow" },
  sms: {
    flows: ["owner-new-signup-by-sms"],
    interfaces: ["ui"],
  },
  smsInbound: {
    flows: ["owner-new-signup-by-sms"],
    interfaces: ["ui"],
  },
  postcards: { todo: "no flow yet — Stannp has no inbound webhook in production yet, see B1484" },
  photobook: {
    flows: ["owner-established-order-photobook"],
    interfaces: ["ui", "api"],
  },
  logging: {
    flows: ["operator-check-admin-dashboard"],
    interfaces: ["admin"],
  },
  credits: {
    flows: ["owner-established-spend-credits"],
    interfaces: ["ui", "api"],
  },
  addressLookup: {
    flows: ["owner-established-address-lookup"],
    interfaces: ["ui"],
  },
  weather: {
    flows: ["owner-established-weather-lookup"],
    interfaces: ["api"],
  },
  analytics: {
    flows: ["operator-check-admin-dashboard"],
    interfaces: ["admin"],
  },
  transcription: {
    flows: ["owner-established-use-agent-helper"],
    interfaces: ["ui"],
  },
  fulfilmentRelay: {
    flows: ["operator-fulfilment-webhook-relay"],
    interfaces: ["admin"],
  },
  fulfilmentAccept: {
    flows: ["operator-fulfilment-webhook-relay"],
    interfaces: ["admin"],
  },
};
