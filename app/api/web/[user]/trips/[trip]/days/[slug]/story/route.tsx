// GET /api/web/{user}/trips/{trip}/days/{slug}/story?look=photo|postcard|collage
// — a 1080×1920 PNG of a published day, for "Share as a story" (B2665).
// Owner only, cookie only — the same gate the sibling `publish`/`unpublish`
// routes use: `isOwner` against the browser cookie, any `Authorization`
// header refused outright (agent bearer tokens reach `/api/**` under
// `/api/v2/`, never a browser-shaped page or this owner-only picture).
//
// Every word drawn on the card is the day's own — `storyCardFacts`
// (`lib/storyCard.ts`) decides what they are, kept pure so a test can
// assert on the strings without decoding a PNG; this route only lays them
// out. The link is drawn only when `isOpenToLink(trip)` and the day is
// published — never otherwise, never invented.
import { ImageResponse } from "next/og";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";
import { readDayFile, readTripFile, resolveDayStem, listDaySlugs } from "@/lib/api/v2/store";
import { getTrip } from "@/lib/trips";
import { isOpenToLink } from "@/lib/access";
import { journalPath } from "@/lib/journalPath";
import { serverSite } from "@/lib/site";
import { dayNumberOf, storyCardFacts, storyDayLink, storyPhotos, type StoryFacts } from "@/lib/storyCard";
import { storyPhotoDataUri } from "@/lib/storyMedia";
import { StoryMark } from "@/components/StoryMark";

export const dynamic = "force-dynamic";

const SIZE = { width: 1080, height: 1920 };

export const STORY_LOOKS = ["photo", "postcard", "collage"] as const;
export type StoryLook = (typeof STORY_LOOKS)[number];

const COLORS = {
  navy950: "#0f1520",
  navy900: "#1e293b",
  navy600: "#44546c",
  navy300: "#aeb7c5",
  navy200: "#d8dee8",
  cream50: "#fffaf0",
  cream100: "#fff3dc",
  cream200: "#ffe9bd",
  yellow400: "#ffd23f",
  green500: "#22c55e",
};

function Pill({ site, dark }: { site: string; dark: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <StoryMark size={52} />
      <div style={{ display: "flex", fontSize: 32, fontWeight: 700, color: dark ? COLORS.cream50 : COLORS.navy900 }}>
        {site}
      </div>
    </div>
  );
}

function EmptyPanel({ background }: { background: string }) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <StoryMark size={120} />
    </div>
  );
}

/** Look A — the published-looking card: a hero photo and a navy caption
 * panel underneath. */
function PhotoCard({ facts, photo, site }: { facts: StoryFacts; photo: string | null; site: string }) {
  // The pill floats over the photo's top-left corner, as drawn. satori paints
  // in document order and ignores z-index, so the pill comes AFTER the image
  // in the markup — placed first, the photo painted over it.
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: COLORS.navy950 }}>
      <div style={{ display: "flex", position: "relative", width: "100%", height: "68%" }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <EmptyPanel background={COLORS.navy900} />
        )}
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 40,
            top: 40,
            padding: "10px 22px 10px 10px",
            borderRadius: 999,
            background: COLORS.navy950,
          }}
        >
          <Pill site={site} dark />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, background: COLORS.navy950, padding: "48px 56px" }}>
        {facts.dayLabel && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                display: "flex",
                width: 12,
                height: 12,
                background: COLORS.yellow400,
                transform: "rotate(45deg)",
              }}
            />
            <div style={{ display: "flex", fontSize: 24, fontWeight: 700, letterSpacing: 2, color: COLORS.yellow400, textTransform: "uppercase" }}>
              {facts.dayLabel} · {facts.dateLabel}
            </div>
          </div>
        )}
        <div style={{ display: "flex", marginTop: 14, fontSize: 56, fontWeight: 700, color: COLORS.cream50, lineHeight: 1.1 }}>
          {facts.title}
        </div>
        {(facts.place || facts.tempLine) && (
          <div style={{ display: "flex", marginTop: 16, fontSize: 28, color: COLORS.navy200 }}>
            {[facts.place, facts.tempLine].filter(Boolean).join(" · ")}
          </div>
        )}
        {facts.link && (
          <div style={{ display: "flex", marginTop: 24, fontSize: 22, color: COLORS.navy300, fontFamily: "monospace" }}>
            {facts.link.replace(/^https?:\/\//, "")}
          </div>
        )}
      </div>
    </div>
  );
}

/** Look B — the postcard: a cream frame around the photo, its own caption
 * in italics underneath, mark + site left and link right in the footer. */
function PostcardCard({ facts, photo, site }: { facts: StoryFacts; photo: string | null; caption?: string; site: string }) {
  const caption = photo ? facts.photos[0]?.caption : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: COLORS.cream100, padding: 48 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          background: COLORS.cream50,
          padding: 24,
          boxShadow: "0 2px 0 rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ display: "flex", width: "100%", height: 1120 }}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <EmptyPanel background={COLORS.cream200} />
          )}
        </div>
        {caption && (
          <div style={{ display: "flex", marginTop: 16, fontSize: 24, fontStyle: "italic", color: COLORS.navy600 }}>{caption}</div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", padding: "32px 8px" }}>
        {facts.dayLabel && (
          <div style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: 1, color: COLORS.navy600, textTransform: "uppercase" }}>
            {facts.dayLabel} · {facts.dateLabel}
          </div>
        )}
        <div style={{ display: "flex", marginTop: 10, fontSize: 48, fontWeight: 700, color: COLORS.navy900 }}>{facts.title}</div>
        {(facts.place || facts.tempLine) && (
          <div style={{ display: "flex", marginTop: 12, fontSize: 26, color: COLORS.navy600 }}>
            {[facts.place, facts.tempLine].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
        <Pill site={site} dark={false} />
        {facts.link && (
          <div style={{ display: "flex", fontSize: 20, color: COLORS.navy600, fontFamily: "monospace" }}>
            {facts.link.replace(/^https?:\/\//, "")}
          </div>
        )}
      </div>
    </div>
  );
}

/** Look C — the collage: header with the trip title and a "Day N" pill,
 * a grid of up to three photos, then the title, date/place and a green-dot
 * link. */
function CollageCard({ facts, photos, site }: { facts: StoryFacts; photos: string[]; site: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: COLORS.navy900, padding: 48 }}>
      <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
        <Pill site={facts.tripTitle} dark />
        {facts.dayLabel && (
          <div
            style={{
              display: "flex",
              background: COLORS.yellow400,
              color: COLORS.navy900,
              fontSize: 22,
              fontWeight: 700,
              padding: "8px 18px",
              borderRadius: 999,
            }}
          >
            {facts.dayLabel}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 32, gap: 12, flex: 1 }}>
        <div style={{ display: "flex", width: "100%", height: "58%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <div style={{ display: "flex", width: "100%", height: "38%", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[1]} alt="" style={{ width: "50%", height: "100%", objectFit: "cover" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[2]} alt="" style={{ width: "50%", height: "100%", objectFit: "cover" }} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 28 }}>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: COLORS.cream50 }}>{facts.title}</div>
        <div style={{ display: "flex", marginTop: 10, fontSize: 26, color: COLORS.navy200 }}>
          {[facts.dateLabel, facts.place].filter(Boolean).join(" · ")}
        </div>
        {facts.link && (
          <div style={{ display: "flex", marginTop: 16, alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", width: 10, height: 10, borderRadius: 999, background: COLORS.green500 }} />
            <div style={{ display: "flex", fontSize: 20, color: COLORS.navy300, fontFamily: "monospace" }}>
              {facts.link.replace(/^https?:\/\//, "")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/days/[slug]/story">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(
      { error: "not_for_agents", message: "This is the owner's own door, from a browser." },
      { status: 403 },
    );
  }

  const { user, trip: tripId, slug } = await params;
  const owner = getUser(user);
  if (!owner) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });

  const tripFile = readTripFile(user, tripId);
  if (!tripFile) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const stem = resolveDayStem(user, tripId, slug);
  const day = stem ? readDayFile(user, tripId, stem) : null;
  if (!stem || !day) return Response.json({ error: "unknown_day" }, { status: 404 });
  if (day.status !== "published") return Response.json({ error: "not_published" }, { status: 409 });

  const url = new URL(request.url);
  const lookParam = url.searchParams.get("look") ?? "photo";
  const look = (STORY_LOOKS as readonly string[]).includes(lookParam) ? (lookParam as StoryLook) : "photo";

  const photos = storyPhotos(day);
  if (look === "collage" && photos.length < 3) {
    return Response.json({ error: "not_enough_photos" }, { status: 409 });
  }

  const trip = getTrip(`${user}/${tripId}`);
  const link = storyDayLink(user, tripId, stem, trip, day);

  const dayNumber = dayNumberOf(listDaySlugs(user, tripId), stem);
  const facts = storyCardFacts({
    day,
    dayNumber,
    tripTitle: tripFile.title,
    link,
    locale: owner.defaultLocale,
  });

  const site = serverSite().name;
  const dataUris = photos.map((p) => storyPhotoDataUri(user, p.src)).filter((u): u is string => u !== null);

  const element =
    look === "postcard" ? (
      <PostcardCard facts={facts} photo={dataUris[0] ?? null} site={site} />
    ) : look === "collage" ? (
      <CollageCard facts={facts} photos={dataUris.slice(0, 3)} site={site} />
    ) : (
      <PhotoCard facts={facts} photo={dataUris[0] ?? null} site={site} />
    );

  // ImageResponse defaults to a public cache header; this card can show a
  // guest or private trip's photographs, so no shared cache may keep it.
  return new ImageResponse(element, { ...SIZE, headers: { "Cache-Control": "private, no-store" } });
}
