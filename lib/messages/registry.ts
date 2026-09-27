/**
 * Every message Fernscout sends, named once — B2438 (plan: docs/plans/W44-messages.md).
 *
 * Plain typed data, no runtime engine (decision D3). A template id is a
 * compile-time string a caller passes to `renderMail`/`sendSms`/the WhatsApp
 * senders; `test/message-registry.test.ts` is what makes an id here with no
 * call site — or a call site naming an id not here — a test failure rather
 * than silent drift. Admin (a later ticket) reads this file; it never writes
 * it.
 */

export const FAMILIES = {
  code: { class: "required" },
  invite: { class: "service" },
  news: { class: "optional" },
  nudge: { class: "optional" },
  receipt: { class: "required" },
  notice: { class: "required" },
  operator: { class: "optional" },
  chat: { class: "required" },
} as const satisfies Record<string, { class: "required" | "service" | "optional" }>;

export type Family = keyof typeof FAMILIES;

export const CHANNELS = ["mail", "sms", "wa", "push", "share"] as const;
export type Channel = (typeof CHANNELS)[number];

export type Audience = "owner" | "reader" | "stranger" | "operator";

export type TemplateDef = {
  family: Family;
  channel: Channel;
  /** One line, English, for admin's catalogue — not shown to a recipient. */
  kind: string;
  audience: Audience;
  /** Only present when the send site lives in the private `paid/` package —
   * the registry test only requires those a call site when `paid/` (or
   * `$WT/paid`) actually exists. */
  paid?: true;
};

/**
 * One entry per message kind and channel. Ids are stable — admin's log and
 * catalogue key off them, so an id, once shipped, is never renamed.
 */
export const TEMPLATES = {
  // -- mail: code (open core) --------------------------------------------
  "code.mail": { family: "code", channel: "mail", kind: "guest sign-in code", audience: "reader" },
  "code.identity.mail": { family: "code", channel: "mail", kind: "identity sign-in code", audience: "stranger" },
  "code.journal.mail": { family: "code", channel: "mail", kind: "owner sign-in code", audience: "owner" },
  "code.signup.mail": { family: "code", channel: "mail", kind: "signup code", audience: "stranger" },
  "code.ownerEmail.mail": { family: "code", channel: "mail", kind: "owner email change code", audience: "owner" },

  // -- mail: invite (open core) -------------------------------------------
  "invite.mail": { family: "invite", channel: "mail", kind: "invite to a reader", audience: "reader" },
  "invite.in.mail": { family: "invite", channel: "mail", kind: "you're in", audience: "reader" },

  // -- mail: notice (open core) --------------------------------------------
  "notice.request": { family: "notice", channel: "mail", kind: "reader request, to the owner", audience: "owner" },
  "notice.delete": { family: "notice", channel: "mail", kind: "deletion confirmation", audience: "owner" },
  "notice.export": { family: "notice", channel: "mail", kind: "export link", audience: "owner" },
  "notice.moved": { family: "notice", channel: "mail", kind: "owner address changed", audience: "owner" },
  "notice.storage": { family: "notice", channel: "mail", kind: "storage quota warning", audience: "owner" },
  "notice.waitlist": { family: "notice", channel: "mail", kind: "iOS waitlist confirmation", audience: "stranger" },
  "notice.welcome": { family: "notice", channel: "mail", kind: "new owner welcome", audience: "owner" },
  "notice.expiryWarn": { family: "notice", channel: "mail", kind: "studio photo expiry warning", audience: "owner" },
  "notice.expiryFinal": { family: "notice", channel: "mail", kind: "studio photo expiry final notice", audience: "owner" },
  "notice.operatorMessage": { family: "notice", channel: "mail", kind: "operator note to the owner", audience: "owner" },
  "notice.buy": { family: "notice", channel: "mail", kind: "credit purchase awaiting payment", audience: "owner", paid: true },
  "notice.creditsRefund": { family: "notice", channel: "mail", kind: "credit refund notice", audience: "owner", paid: true },
  "notice.postcardCancelled": { family: "notice", channel: "mail", kind: "postcard cancelled", audience: "owner", paid: true },
  "notice.photobookRefused": { family: "notice", channel: "mail", kind: "photobook order refused", audience: "owner", paid: true },

  // -- mail: news / nudge (open core) --------------------------------------
  "news.mail": { family: "news", channel: "mail", kind: "day published letter", audience: "reader" },
  "nudge.evening": { family: "nudge", channel: "mail", kind: "evening reminder to write", audience: "owner" },

  // -- mail: operator (open core) ------------------------------------------
  "op.spend": { family: "operator", channel: "mail", kind: "nightly spend alert", audience: "operator" },
  "op.alert": { family: "operator", channel: "mail", kind: "backup/job alert", audience: "operator" },
  "op.grantApproval": { family: "operator", channel: "mail", kind: "credit grant/purchase awaiting approval", audience: "operator", paid: true },

  // -- mail: receipt (paid) -------------------------------------------------
  "receipt.credits": { family: "receipt", channel: "mail", kind: "credit purchase receipt", audience: "owner", paid: true },
  "receipt.postcard": { family: "receipt", channel: "mail", kind: "postcard order receipt", audience: "owner", paid: true },
  "receipt.photobook": { family: "receipt", channel: "mail", kind: "photobook order receipt", audience: "owner", paid: true },

  // -- sms (open core) ------------------------------------------------------
  "code.sms": { family: "code", channel: "sms", kind: "sign-in / phone-verify code", audience: "reader" },
  "invite.share": { family: "invite", channel: "share", kind: "invite the owner shares", audience: "reader" },
  "invite.sms": { family: "invite", channel: "sms", kind: "invite to a reader", audience: "reader" },
  "invite.in.sms": { family: "invite", channel: "sms", kind: "you're in", audience: "reader" },
  "news.sms": { family: "news", channel: "sms", kind: "day published text", audience: "reader" },
  "op.sms": { family: "operator", channel: "sms", kind: "operator text to the owner", audience: "owner" },

  // -- whatsapp (paid) --------------------------------------------------------
  "news.wa": { family: "news", channel: "wa", kind: "day published announcement", audience: "reader", paid: true },
  "code.wa": { family: "code", channel: "wa", kind: "phone-verify code", audience: "owner", paid: true },
  "chat.wa": { family: "chat", channel: "wa", kind: "free-form reply", audience: "reader", paid: true },
  "nudge.gap.wa": { family: "nudge", channel: "wa", kind: "gap follow-up question", audience: "owner", paid: true },

  // -- push (open core) -------------------------------------------------------
  "news.push": { family: "news", channel: "push", kind: "day published push", audience: "reader" },
} as const satisfies Record<string, TemplateDef>;

export type TemplateId = keyof typeof TEMPLATES;

export function templateDef(id: TemplateId): TemplateDef {
  return TEMPLATES[id];
}

/** A flow's own node shape — drawn by admin (a later ticket), checked here by
 * the registry test only for internal consistency (every `to` id exists,
 * every `send` node names a real template). */
export type FlowNode = {
  id: string;
  type: "trigger" | "check" | "wait" | "send" | "stop";
  label: string;
  sub?: string;
  template?: TemplateId;
  to: { id: string; label?: string }[];
};

export type Flow = {
  id: string;
  label: string;
  nodes: FlowNode[];
};

/**
 * The flows drawn in the W44 draft, as data. Each is a flat list of nodes;
 * `to` names the next node(s) by id within the same flow. Kept intentionally
 * light — enough for the registry test and a future admin page to draw a
 * tree, not a second description of what the code already does.
 */
export const FLOWS = [
  {
    id: "signin",
    label: "Signing in",
    nodes: [
      { id: "ask", type: "trigger", label: "Somebody asks for a code", to: [{ id: "send" }] },
      { id: "send", type: "send", label: "Send the code", template: "code.mail", to: [{ id: "redeem" }] },
      { id: "redeem", type: "check", label: "Code redeemed within its window?", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Session opens", to: [] },
    ],
  },
  {
    id: "invite",
    label: "Owner invites a reader",
    nodes: [
      { id: "start", type: "trigger", label: "Owner adds a person", to: [{ id: "send" }] },
      { id: "send", type: "send", label: "Send the invite", template: "invite.mail", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Waiting for them to open it", to: [] },
    ],
  },
  {
    id: "join",
    label: "Stranger asks to join",
    nodes: [
      { id: "ask", type: "trigger", label: "Somebody asks on a group link", to: [{ id: "code" }] },
      { id: "code", type: "send", label: "Send the code", template: "code.mail", to: [{ id: "notify" }] },
      { id: "notify", type: "send", label: "Tell the owner", template: "notice.request", to: [{ id: "approve" }] },
      { id: "approve", type: "check", label: "Owner lets them in", to: [{ id: "in" }] },
      { id: "in", type: "send", label: "Tell them they're in", template: "invite.in.mail", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "They can read", to: [] },
    ],
  },
  {
    id: "newday",
    label: "A day is published",
    nodes: [
      { id: "publish", type: "trigger", label: "Owner publishes a day", to: [{ id: "mail" }, { id: "sms" }, { id: "wa" }, { id: "push" }] },
      { id: "mail", type: "send", label: "Mail readers who chose email", template: "news.mail", to: [{ id: "stop" }] },
      { id: "sms", type: "send", label: "Text readers who chose SMS", template: "news.sms", to: [{ id: "stop" }] },
      { id: "wa", type: "send", label: "WhatsApp readers who chose it", template: "news.wa", to: [{ id: "stop" }] },
      { id: "push", type: "send", label: "Push readers who chose it", template: "news.push", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Readers notified", to: [] },
    ],
  },
  {
    id: "evening",
    label: "Evening reminder",
    nodes: [
      { id: "check", type: "check", label: "A trip is running and today has nothing yet", to: [{ id: "send" }] },
      { id: "send", type: "send", label: "Remind the owner", template: "nudge.evening", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Sent once a day at most", to: [] },
    ],
  },
  {
    id: "gap",
    label: "Studio gap follow-up",
    nodes: [
      { id: "check", type: "check", label: "A day folder is missing a location or any words", to: [{ id: "send" }] },
      { id: "send", type: "send", label: "Ask on WhatsApp", template: "nudge.gap.wa", to: [{ id: "answer" }] },
      { id: "answer", type: "check", label: "Answered or declined?", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "At most two asks, ever, per day", to: [] },
    ],
  },
  {
    id: "import",
    label: "Photo import",
    nodes: [
      { id: "start", type: "trigger", label: "Owner starts a studio import run", to: [{ id: "warn" }] },
      { id: "warn", type: "wait", label: "Run sits untouched", to: [{ id: "expiryWarn" }] },
      { id: "expiryWarn", type: "send", label: "Warn it will expire", template: "notice.expiryWarn", to: [{ id: "final" }] },
      { id: "final", type: "send", label: "Final notice", template: "notice.expiryFinal", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Run swept", to: [] },
    ],
  },
  {
    id: "storage",
    label: "Storage quota",
    nodes: [
      { id: "check", type: "check", label: "A journal nears its storage limit", to: [{ id: "send" }] },
      { id: "send", type: "send", label: "Warn the owner", template: "notice.storage", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Sent", to: [] },
    ],
  },
  {
    id: "account",
    label: "Account changes",
    nodes: [
      { id: "change", type: "trigger", label: "Owner changes their address, deletes or exports", to: [{ id: "code" }] },
      { id: "code", type: "send", label: "Prove the new address", template: "code.ownerEmail.mail", to: [{ id: "notice" }] },
      { id: "notice", type: "send", label: "Tell the old address, or confirm delete/export", template: "notice.moved", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Done", to: [] },
    ],
  },
  {
    id: "money",
    label: "Buying credits",
    nodes: [
      { id: "buy", type: "trigger", label: "Owner asks to buy credits", to: [{ id: "buyMail" }] },
      { id: "buyMail", type: "send", label: "Payment instructions", template: "notice.buy", to: [{ id: "approve" }] },
      { id: "approve", type: "send", label: "Ask the operator to approve", template: "op.grantApproval", to: [{ id: "receipt" }] },
      { id: "receipt", type: "send", label: "Receipt", template: "receipt.credits", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Balance updated", to: [] },
    ],
  },
  {
    id: "waitlist",
    label: "iOS app waitlist",
    nodes: [
      { id: "join", type: "trigger", label: "Visitor leaves their address", to: [{ id: "send" }] },
      { id: "send", type: "send", label: "Confirm", template: "notice.waitlist", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "On the list", to: [] },
    ],
  },
  {
    id: "helper",
    label: "WhatsApp helper",
    nodes: [
      { id: "onboard", type: "trigger", label: "Somebody starts on WhatsApp", to: [{ id: "code" }] },
      { id: "code", type: "send", label: "Verify the number", template: "code.wa", to: [{ id: "chat" }] },
      { id: "chat", type: "send", label: "Every reply", template: "chat.wa", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Journal kept", to: [] },
    ],
  },
  {
    id: "operator",
    label: "Operator watches the instance",
    nodes: [
      { id: "nightly", type: "trigger", label: "Nightly backup/job runs", to: [{ id: "alert" }, { id: "spend" }] },
      { id: "alert", type: "send", label: "Alert on failure", template: "op.alert", to: [{ id: "stop" }] },
      { id: "spend", type: "send", label: "Alert over the spend line", template: "op.spend", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Operator informed", to: [] },
    ],
  },
] as const satisfies readonly Flow[];
