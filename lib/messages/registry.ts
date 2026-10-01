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

type Audience = "owner" | "reader" | "stranger" | "operator";

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
  "notice.inviteRequest": { family: "notice", channel: "mail", kind: "invite request confirmation", audience: "stranger" },
  "notice.welcome": { family: "notice", channel: "mail", kind: "new owner welcome", audience: "owner" },
  "notice.expiryWarn": { family: "notice", channel: "mail", kind: "studio photo expiry warning", audience: "owner" },
  "notice.expiryFinal": { family: "notice", channel: "mail", kind: "studio photo expiry final notice", audience: "owner" },
  "notice.operatorMessage": { family: "notice", channel: "mail", kind: "operator note to the owner", audience: "owner" },
  "notice.postcardCancelled": { family: "notice", channel: "mail", kind: "postcard cancelled", audience: "owner", paid: true },
  "notice.photobookRefused": { family: "notice", channel: "mail", kind: "photobook order refused", audience: "owner", paid: true },
  "notice.paymentFailed": { family: "notice", channel: "mail", kind: "Plus renewal payment failed, grace started", audience: "owner", paid: true },
  "notice.renewalReminder": { family: "notice", channel: "mail", kind: "Plus renews in 30 days", audience: "owner", paid: true },
  "notice.passEndingSoon": { family: "notice", channel: "mail", kind: "Trip pass ends in 5 days", audience: "owner", paid: true },
  "notice.passEnded": { family: "notice", channel: "mail", kind: "Trip pass has ended", audience: "owner", paid: true },

  // -- mail: news / nudge (open core) --------------------------------------
  "news.mail": { family: "news", channel: "mail", kind: "day published", audience: "reader" },
  "nudge.evening": { family: "nudge", channel: "mail", kind: "evening reminder to write", audience: "owner" },
  "nudge.first.mail": { family: "nudge", channel: "mail", kind: "first-trip nudge", audience: "owner" },

  // -- mail: operator (open core) ------------------------------------------
  "op.spend": { family: "operator", channel: "mail", kind: "nightly spend alert", audience: "operator" },
  "op.alert": { family: "operator", channel: "mail", kind: "backup/job alert", audience: "operator" },
  "op.grantApproval": { family: "operator", channel: "mail", kind: "pass/Plus grant awaiting approval", audience: "operator", paid: true },

  // -- mail: receipt (paid) -------------------------------------------------
  "receipt.plan": { family: "receipt", channel: "mail", kind: "pass/Plus purchase receipt", audience: "owner", paid: true },
  "receipt.postcard": { family: "receipt", channel: "mail", kind: "postcard order receipt", audience: "owner", paid: true },
  "receipt.photobook": { family: "receipt", channel: "mail", kind: "photobook order receipt", audience: "owner", paid: true },

  // -- sms (open core) ------------------------------------------------------
  // B2597: readers sign in by email only, and no plan sends a reader an SMS
  // any more — `code.sms` survives only as the owner's own signup/phone-verify
  // code (`lib/phoneVerify/sms.ts`); `invite.sms`, `invite.in.sms` and
  // `news.sms` had no other call site and are gone.
  "code.sms": { family: "code", channel: "sms", kind: "phone-verify code", audience: "owner" },
  "invite.share": { family: "invite", channel: "share", kind: "invite the owner shares", audience: "reader" },
  "op.sms": { family: "operator", channel: "sms", kind: "operator text to the owner", audience: "owner" },

  // -- whatsapp (paid) --------------------------------------------------------
  "news.wa": { family: "news", channel: "wa", kind: "day published", audience: "reader", paid: true },
  "code.wa": { family: "code", channel: "wa", kind: "phone-verify code", audience: "owner", paid: true },
  "chat.wa": { family: "chat", channel: "wa", kind: "free-form reply", audience: "reader", paid: true },
  "nudge.gap.wa": { family: "nudge", channel: "wa", kind: "gap follow-up question", audience: "owner", paid: true },

  // -- push (open core) -------------------------------------------------------
  "news.push": { family: "news", channel: "push", kind: "day published", audience: "reader" },
  "nudge.first.push": { family: "nudge", channel: "push", kind: "first-trip nudge", audience: "owner" },
} as const satisfies Record<string, TemplateDef>;

export type TemplateId = keyof typeof TEMPLATES;

export function templateDef(id: TemplateId): TemplateDef {
  return TEMPLATES[id];
}

/** A flow's own node shape — drawn by admin (a later ticket), checked here by
 * the registry test only for internal consistency (every `to` id exists,
 * every `send` node names a real template). */
type FlowNode = {
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
      {
        id: "ask",
        type: "trigger",
        label: "Somebody asks for a code",
        // B2597 — readers sign in by email only; the "Reader, by phone" leg
        // is gone.
        to: [
          { id: "sendMail", label: "Reader, by email" },
          { id: "sendOwner", label: "Owner or agent" },
          { id: "sendIdentity", label: "Anywhere on this instance" },
        ],
      },
      { id: "sendMail", type: "send", label: "Send the code", template: "code.mail", to: [{ id: "redeem" }] },
      { id: "sendOwner", type: "send", label: "Send the code", template: "code.journal.mail", to: [{ id: "redeem" }] },
      { id: "sendIdentity", type: "send", label: "Send the code", template: "code.identity.mail", to: [{ id: "redeem" }] },
      { id: "redeem", type: "check", label: "Code redeemed within its window?", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Session opens", to: [] },
    ],
  },
  {
    id: "invite",
    label: "Owner invites a reader",
    nodes: [
      {
        id: "start",
        type: "trigger",
        label: "Owner presses invite for a person",
        // B2597 — SMS retired as an invite channel.
        to: [
          { id: "mail", label: "Email" },
          { id: "share", label: "Owner's own share sheet" },
        ],
      },
      { id: "mail", type: "send", label: "Send the invite", template: "invite.mail", to: [{ id: "stop" }] },
      { id: "share", type: "send", label: "Log that the owner shared it themselves", template: "invite.share", to: [{ id: "stop" }] },
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
      // B2597 — readers sign in by email only; there is no phone leg left.
      { id: "approve", type: "check", label: "Owner lets them in", to: [{ id: "mail", label: "Confirmed email" }] },
      { id: "mail", type: "send", label: "Tell them they're in", template: "invite.in.mail", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "They can read", to: [] },
    ],
  },
  {
    id: "newday",
    label: "A day is published",
    nodes: [
      // B2597 — SMS retired; WhatsApp stays registered (the Meta sender and
      // inbound webhook are kept for Fernscout's own future marketing) but
      // `sendDayWhatsapp` refuses every day announcement outright now.
      { id: "publish", type: "trigger", label: "Owner publishes a day", to: [{ id: "mail", label: "Email" }, { id: "wa", label: "WhatsApp (retired, B2597)" }, { id: "push", label: "App push" }] },
      { id: "mail", type: "send", label: "Mail readers who chose email", template: "news.mail", to: [{ id: "stop" }] },
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
    id: "firsttrip",
    label: "First-trip nudge",
    nodes: [
      { id: "created", type: "trigger", label: "A journal is created", to: [{ id: "tips" }] },
      { id: "tips", type: "check", label: "Tips checked at signup?", to: [{ id: "wait2" }] },
      { id: "wait2", type: "wait", label: "Two days go by with no trip", to: [{ id: "pushCheck" }] },
      {
        id: "pushCheck",
        type: "check",
        label: "Owner's own device subscribed to push?",
        to: [{ id: "push", label: "Yes" }, { id: "wait3", label: "No" }],
      },
      { id: "push", type: "send", label: "Push the nudge", template: "nudge.first.push", to: [{ id: "wait5" }] },
      { id: "wait5", type: "wait", label: "Three more days go by with no trip", to: [{ id: "mailAfterPush" }] },
      { id: "mailAfterPush", type: "send", label: "Mail the nudge too", template: "nudge.first.mail", to: [{ id: "stop" }] },
      { id: "wait3", type: "wait", label: "One more day goes by with no trip", to: [{ id: "mailOnly" }] },
      { id: "mailOnly", type: "send", label: "Mail the nudge", template: "nudge.first.mail", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Sent once, ever, per account", to: [] },
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
      {
        id: "change",
        type: "trigger",
        label: "Owner changes their address, deletes or exports",
        to: [
          { id: "addrCode", label: "Change address" },
          { id: "delete", label: "Delete a journal or trip" },
          { id: "export", label: "Export a copy" },
        ],
      },
      { id: "addrCode", type: "send", label: "Prove the new address", template: "code.ownerEmail.mail", to: [{ id: "notice" }] },
      { id: "notice", type: "send", label: "Tell the old address", template: "notice.moved", to: [{ id: "stop" }] },
      { id: "delete", type: "send", label: "Confirmation link, with an export first", template: "notice.delete", to: [{ id: "stop" }] },
      { id: "export", type: "send", label: "Send the export link", template: "notice.export", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Done", to: [] },
    ],
  },
  // B2593 — a pass or Plus: paid through Stripe (a receipt), or with no
  // Stripe key the operator's approval mail and a grant by hand from /admin.
  {
    id: "plans",
    label: "Buying a pass or Plus",
    nodes: [
      {
        id: "buyPlan",
        type: "trigger",
        label: "Owner buys a pass or subscribes to Plus",
        to: [{ id: "planReceipt" }],
      },
      {
        id: "planReceipt",
        type: "send",
        label: "Plan receipt",
        template: "receipt.plan",
        to: [{ id: "renewalFailed" }, { id: "renewalDue" }, { id: "passEndingSoon" }, { id: "passEnded" }, { id: "stop" }],
      },
      { id: "renewalFailed", type: "trigger", label: "Later, a Plus renewal payment fails", to: [{ id: "failedMail" }] },
      { id: "failedMail", type: "send", label: "Payment failed, grace started", template: "notice.paymentFailed", to: [{ id: "stop" }] },
      { id: "renewalDue", type: "trigger", label: "Later, Plus is 30 days from renewing", to: [{ id: "renewalMail" }] },
      { id: "renewalMail", type: "send", label: "Renewal reminder", template: "notice.renewalReminder", to: [{ id: "stop" }] },
      { id: "passEndingSoon", type: "trigger", label: "Later, a Trip pass has 5 days left", to: [{ id: "passEndingMail" }] },
      { id: "passEndingMail", type: "send", label: "Pass ends in 5 days", template: "notice.passEndingSoon", to: [{ id: "stop" }] },
      { id: "passEnded", type: "trigger", label: "Later, a Trip pass's days run out", to: [{ id: "passEndedMail" }] },
      { id: "passEndedMail", type: "send", label: "Pass has ended", template: "notice.passEnded", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Plan updated", to: [] },
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
    id: "inviteRequest",
    label: "Invite requests",
    nodes: [
      { id: "ask", type: "trigger", label: "Stranger asks for an invite on a closed instance", to: [{ id: "send" }] },
      { id: "send", type: "send", label: "Neutral confirmation", template: "notice.inviteRequest", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Waiting on the operator, in /admin", to: [] },
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
      { id: "nightly", type: "trigger", label: "Nightly backup/job runs", to: [{ id: "alert", label: "A job failed" }, { id: "spend", label: "Spend over the line" }] },
      { id: "alert", type: "send", label: "Alert on failure", template: "op.alert", to: [{ id: "stop" }] },
      { id: "spend", type: "send", label: "Alert over the spend line", template: "op.spend", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Operator informed", to: [] },
    ],
  },
  {
    id: "signup",
    label: "Creating a journal",
    nodes: [
      { id: "ask", type: "trigger", label: "Somebody asks to sign up", to: [{ id: "code" }] },
      { id: "code", type: "send", label: "Prove the address", template: "code.signup.mail", to: [{ id: "redeem" }] },
      { id: "redeem", type: "check", label: "Code redeemed?", to: [{ id: "phone" }] },
      {
        id: "phone",
        type: "check",
        label: "This server proves the phone number by SMS?",
        to: [{ id: "sms", label: "Yes" }, { id: "create", label: "No — WhatsApp or exempt" }],
      },
      { id: "sms", type: "send", label: "Text the phone-verify code", template: "code.sms", to: [{ id: "create" }] },
      { id: "create", type: "trigger", label: "Journal created", to: [{ id: "welcome" }] },
      { id: "welcome", type: "send", label: "Welcome mail", template: "notice.welcome", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Journal ready", to: [] },
    ],
  },
  {
    id: "postcard",
    label: "Postcard order",
    nodes: [
      {
        id: "order",
        type: "trigger",
        label: "Owner sends a postcard order to the printer",
        to: [{ id: "receipt" }, { id: "approve" }],
      },
      // B2594 — no STRIPE_SECRET_KEY set: the operator approves by hand
      // before anything prints. Same door photobook's own order uses below.
      { id: "approve", type: "send", label: "Ask the operator to approve, no Stripe key", template: "op.grantApproval", to: [{ id: "receipt" }] },
      { id: "receipt", type: "send", label: "Order receipt", template: "receipt.postcard", to: [{ id: "reconcile" }] },
      {
        id: "reconcile",
        type: "check",
        label: "Printer later reports a card cancelled?",
        to: [{ id: "cancelled", label: "Yes" }, { id: "stop", label: "No" }],
      },
      { id: "cancelled", type: "send", label: "Cancellation and refund", template: "notice.postcardCancelled", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Done", to: [] },
    ],
  },
  {
    id: "photobook",
    label: "Photobook order",
    nodes: [
      { id: "order", type: "trigger", label: "Owner orders a photobook", to: [{ id: "build" }] },
      {
        id: "build",
        type: "check",
        label: "Build step, or the printer, refuses the order?",
        to: [{ id: "refused", label: "Yes" }, { id: "ship", label: "No" }],
      },
      { id: "refused", type: "send", label: "Refusal and refund", template: "notice.photobookRefused", to: [{ id: "stop" }] },
      { id: "ship", type: "send", label: "Receipt, then a shipped notice", template: "receipt.photobook", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Done", to: [] },
    ],
  },
  {
    id: "opMessage",
    label: "Operator writes to the owner",
    nodes: [
      {
        id: "ask",
        type: "trigger",
        label: "Operator sends a note from /admin",
        to: [{ id: "mail", label: "Mail" }, { id: "sms", label: "SMS" }],
      },
      { id: "mail", type: "send", label: "Send the note", template: "notice.operatorMessage", to: [{ id: "stop" }] },
      { id: "sms", type: "send", label: "Text the note", template: "op.sms", to: [{ id: "stop" }] },
      { id: "stop", type: "stop", label: "Sent", to: [] },
    ],
  },
] as const satisfies readonly Flow[];
