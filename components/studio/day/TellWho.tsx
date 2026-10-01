"use client";

import { useI18n } from "@/components/LocaleProvider";
import { GroupDot } from "@/components/studio/readers/groups";

/**
 * "Who is told" on the studio's publish step — TIX-6 phase 2.
 *
 * The owner's reader groups as chips (everyone by default, or what they chose
 * last time on this trip), and what that pick actually sends: an app
 * notification to whoever has one on, and — only if ticked — an email to
 * whoever asked for one. The counts come from the same functions the sends
 * use (`lib/digest/tellChoice.ts`), so the number here is the number that
 * goes out. Picking only ever narrows who is told; who may read the day is
 * its visibility, said in the line above this one.
 */

type TellGroup = { id: string; name: string; color: number };
type TellPersonView = { group: string; push: boolean; mail: boolean };
export type TellProps = {
  groups: TellGroup[];
  people: TellPersonView[];
  anonymousPush: number;
  pushOn: boolean;
  mailOn: boolean;
};

/** `"none"`: readers in no group — the same key the server uses. */
const NO_GROUP = "none";

export function tellCounts(tell: TellProps, selected: string[] | null, mail: boolean) {
  const included = tell.people.filter((p) => selected === null || selected.includes(p.group));
  const anonymous = selected === null && tell.pushOn ? tell.anonymousPush : 0;
  const push = included.filter((p) => tell.pushOn && p.push).length + anonymous;
  const mailable = included.filter((p) => tell.mailOn && p.mail).length;
  const told = included.filter((p) => (tell.pushOn && p.push) || (mail && tell.mailOn && p.mail)).length + anonymous;
  return { push, mailable, told };
}

export default function TellWho({
  tell,
  selected,
  onSelect,
  mail,
  onMail,
}: {
  tell: TellProps;
  selected: string[] | null;
  onSelect: (selected: string[] | null) => void;
  mail: boolean;
  onMail: (mail: boolean) => void;
}) {
  const { t, tn } = useI18n();
  const { push, mailable } = tellCounts(tell, selected, mail);
  const chip = (on: boolean) =>
    `inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-semibold ${
      on ? "border-line-ink bg-action-strong text-on-action" : "border-line-strong bg-surface-raised text-ink-strong hover:bg-surface-subtle"
    }`;
  const toggle = (key: string) => {
    const now = selected ?? [];
    onSelect(now.includes(key) ? now.filter((k) => k !== key) : [...now, key]);
  };
  const choices = [...tell.groups.map((g) => ({ key: g.id, name: g.name, group: g as TellGroup | null })), { key: NO_GROUP, name: t("readers.groups.none"), group: null }];

  if (!tell.pushOn && !tell.mailOn) return <p>{t("studio.publish.tellOffServer")}</p>;

  return (
    <div className="space-y-2">
      {tell.groups.length > 0 && (
        <div role="group" aria-label={t("studio.publish.tellGroupsLabel")} className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={selected === null} onClick={() => onSelect(null)} className={chip(selected === null)}>
            {t("studio.publish.tellEveryone")}
          </button>
          {choices.map((c) => {
            const on = selected !== null && selected.includes(c.key);
            return (
              <button key={c.key} type="button" aria-pressed={on} onClick={() => toggle(c.key)} className={chip(on)}>
                <GroupDot group={c.group} size={8} />
                {c.name}
              </button>
            );
          })}
        </div>
      )}
      {tell.pushOn && <p data-tell-push={push}>{tn("studio.publish.tellPush", push, { count: String(push) })}</p>}
      {tell.mailOn && mailable > 0 && (
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" className="size-5" checked={mail} onChange={(event) => onMail(event.target.checked)} />
          <span>{tn("studio.publish.tellMail", mailable, { count: String(mailable) })}</span>
        </label>
      )}
      {selected !== null && tell.pushOn && tell.anonymousPush > 0 && (
        <p className="text-ink-secondary">{tn("studio.publish.tellAnonymous", tell.anonymousPush, { count: String(tell.anonymousPush) })}</p>
      )}
    </div>
  );
}
