import EditDayFlow from "@/components/studio/day/EditDayFlow";
import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { daysForEditPicker, dayForEdit } from "@/lib/studio/editDay";

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

/**
 * "Change a day" — B1831, spec §6. `EditDay.tsx` is reused whole and
 * unchanged in shape (only additively extended — `confirmBeforeSave`, D12's
 * `If-Match` — see its own doc comments); the only genuinely missing piece
 * was the way in. That is this page: a picker (E1) when no day is chosen,
 * and the panel (E2) once one is, addressed by `?slug=` — the same
 * convention `AddDayFlow`'s own collision screen already writes
 * (`/studio/day/edit?slug=…`), so every existing deep link into this route
 * keeps working.
 *
 * `?slug=` is one lead-entry slug (H5's own linkable URL) — `dayForEdit`
 * searches every trip for it server-side, the same read `daysForEditPicker`
 * itself uses, so a bookmarked or shared link always resolves to the same
 * day the picker would have shown.
 */
export default async function StudioEditDayPage({
  params,
  searchParams,
}: PageProps<"/at/[user]/studio/day/edit">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const { slug } = await searchParams;

  const picker = daysForEditPicker(user);
  const chosen = typeof slug === "string" && slug ? dayForEdit(user, slug) : null;

  const locale = await requestLocale();

  return (
    <StudioPage
      username={user}
      group="write"
      hideGroups
      title={translateIn(locale, "studio.hub.item.changeDay.title")}
      lede={chosen ? undefined : translateIn(locale, "studio.day.edit.consequence")}
    >
      <EditDayFlow username={user} picker={picker} chosenSlug={typeof slug === "string" ? slug : undefined} editable={chosen} />
    </StudioPage>
  );
}
