import Link from "next/link";
import { useI18n } from "./LocaleProvider";
import { OWNER_TOOL, OWNER_TOOL_CELL } from "./ownerToolClass";

/**
 * "Invite family to read", on the day she just published — B799.
 *
 * B2295 (one door for readers, B2291): this used to make a guest link itself
 * — a fetch on mount to see whether the journal even offers one, then a
 * `POST` that minted it right here. That put a second place in the product
 * that could grant somebody access to a journal, beside
 * `/<user>/studio/readers`, which the owner decided should be the only one.
 * So this is a plain link now — same tile, same grid cell, no fetch, no
 * state — to the one page that actually adds or invites a person.
 */
export default function InviteToRead({ username }: { username: string }) {
  const { t } = useI18n();
  return (
    <div className={OWNER_TOOL_CELL}>
      <Link href={`/${username}/studio/readers`} className={OWNER_TOOL}>
        {t("invite.share")}
      </Link>
    </div>
  );
}
