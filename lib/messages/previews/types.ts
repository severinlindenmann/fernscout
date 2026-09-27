import type { MailContent } from "../../mail/template";
import type { Channel, TemplateId } from "../registry";

export type PreviewLocale = "en" | "de" | "hu";

/**
 * What one send site composes, before any address is attached — B2493. The
 * send calls the same composer with real values; a preview calls it with
 * `SAMPLE` (lib/messages/fixtures.ts). That shared call is what makes a
 * preview correct rather than a second copy of the wording.
 */
export type Composition =
  | { channel: "mail"; subject: string; content: MailContent }
  | { channel: Exclude<Channel, "mail">; title?: string; text: string }
  /** No fixed text exists (the assistant's free-form reply): the preview
   * says so instead of inventing an example. */
  | { channel: Exclude<Channel, "mail">; freeform: string };

type PreviewBuilder = (locale: PreviewLocale) => Composition | Promise<Composition>;
export type PreviewMap = Partial<Record<TemplateId, PreviewBuilder>>;
