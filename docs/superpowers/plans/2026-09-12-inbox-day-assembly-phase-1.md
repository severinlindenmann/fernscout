# Inbox day-assembly, Phase 1: new inbox content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen what can land in a journal's inbox — a browser "share my
current location" button, WhatsApp location pins and shared contacts routed
into the inbox instead of their current automatic side-effects, and EXIF
(GPS + capture time) read from an uploaded photograph — so later phases have
new content to build a day-assembly conversation around.

**Architecture:** Extends `lib/inbox.ts`'s existing `INBOX_KINDS`/`InboxMeta`
registry with two new kinds (`location`, `contact`) and three new sidecar
fields, rather than a parallel mechanism. The browser button and the two
WhatsApp handlers all funnel into the same `storeInboxFile`/
`receiveInboxUpload` path already shared by every other inbox writer.

**Tech Stack:** Next.js route handlers, `lib/inbox.ts`, `sharp`/`exifr` for
image metadata, existing WhatsApp dispatch (`lib/whatsapp/dispatch.ts`).

**Spec:** `docs/superpowers/specs/2026-09-12-inbox-day-assembly-design.md`
(Phase 1 section)

## Global Constraints

- Every optional capability stays absent, not broken, when off
  (`addressLookup` gates reverse-geocoding exactly as it already does for
  WhatsApp).
- Nothing invented: EXIF is a named, sourced exception to "nothing on a
  sidecar is inferred" — every EXIF-derived value carries `measuredFrom:
  "exif"` so no later reader mistakes it for something the person said.
- A new string in the UI needs real German and real Hungarian, then
  `npm run i18n:keys` — never a machine-plausible guess (AGENTS.md).
- The guest-invite capability a shared contact card used to trigger
  automatically must still exist after this phase — as a deliberate press,
  not a side-effect of sharing the card.
- `npm run verify` (build → tsc → eslint → vitest → knip) is the gate for
  every task; run the one changed test file while iterating, the full
  command before each commit that finishes a task.

---

## File structure

| File | Responsibility |
| --- | --- |
| `lib/inbox.ts` | Modify: `INBOX_KINDS` grows `location`/`contact`; `InboxMeta` grows `location`/`country`/`countryCode`, `measuredFrom`, `descriptionAsked` |
| `lib/ingest/exif.ts` | Create: reads GPS + capture time out of an image buffer, best-effort |
| `lib/inboxUpload.ts` | Modify: `receiveInboxUpload` calls the EXIF reader for `media` kind, and reverse-geocodes a `location`-kind item, before writing |
| `components/HelperAsk.tsx` | Modify: new `onShareLocation?: () => void` prop, rendered beside the mobile paperclip button |
| `components/HelperRoom.tsx` | Modify: implements `onShareLocation` — captures the browser's position, uploads it through the room's existing inbox door |
| `components/InboxFileGroups.tsx` | Modify: `location`/`contact` items get their own icon instead of the generic document one |
| `lib/whatsapp/dispatch.ts` | Modify: `handleLocationPin` and `handleContactCard` store into the inbox instead of auto-attaching/auto-inviting |
| `lib/whatsapp/vcard.ts` | Create: serialises a parsed WhatsApp contact into minimal vCard bytes, for storage |
| `lib/helper/tools/areas/files.ts` | Modify: new `invite_contact` tool — the deliberate press that replaces the auto-invite |
| `site/locales/{en,de,hu}.json` | Modify: new strings for the location button, the new tool, the icons' accessible labels |

---

## Task 1: New inbox kinds and sidecar fields

**Files:**
- Modify: `lib/inbox.ts:66` (`INBOX_KINDS`), `lib/inbox.ts:79-103` (`InboxMeta`)
- Test: `test/helper-room-files.test.ts`

**Interfaces:**
- Produces: `InboxKind` now includes `"location" | "contact"`;
  `InboxMeta` now includes `location?: string`, `country?: string`,
  `countryCode?: string`, `measuredFrom?: "exif"`, `descriptionAsked?:
  boolean` — every later task in this plan reads or writes these exact
  names.

- [ ] **Step 1: Write the failing test**

Add to `test/helper-room-files.test.ts` (the file already has a `journal()`
fixture helper and a `storeInboxFile` import — extend both, do not
duplicate them):

```ts
test("a location item stores its coordinate and place name, and a contact item stores as its own kind", () => {
  journal();
  const location = storeInboxFile(
    "u",
    "location",
    "location.json",
    Buffer.from(JSON.stringify({ lat: 46.02, lon: 7.75 })),
    { lat: 46.02, lon: 7.75, location: "Zermatt", country: "Switzerland", countryCode: "CH" },
  );
  expect(location.entry.kind).toBe("location");
  expect(location.entry.location).toBe("Zermatt");

  const contact = storeInboxFile(
    "u",
    "contact",
    "maria.vcf",
    Buffer.from("BEGIN:VCARD\nVERSION:3.0\nFN:Maria\nEND:VCARD\n"),
    {},
  );
  expect(contact.entry.kind).toBe("contact");
});

test("descriptionAsked and measuredFrom round-trip through the sidecar", () => {
  journal();
  const stored = storeInboxFile(
    "u",
    "media",
    "sunset.jpg",
    Buffer.from("not a real jpeg"),
    { lat: 46.02, lon: 7.75, measuredFrom: "exif", descriptionAsked: true },
  );
  expect(stored.entry.measuredFrom).toBe("exif");
  expect(stored.entry.descriptionAsked).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/helper-room-files.test.ts`
Expected: FAIL — `storeInboxFile` refuses kind `"location"`/`"contact"` (not
in `INBOX_KINDS`), and `InboxMeta` has no `location`/`measuredFrom`/
`descriptionAsked` fields, so TypeScript itself will not compile the test.

- [ ] **Step 3: Add the two kinds and three fields**

In `lib/inbox.ts`, change:

```ts
export const INBOX_KINDS = ["media", "files", "photobook", "postcards"] as const;
```

to:

```ts
export const INBOX_KINDS = ["media", "files", "photobook", "postcards", "location", "contact"] as const;
```

And extend `InboxMeta`:

```ts
export type InboxMeta = {
  description?: string;
  lat?: number;
  lon?: number;
  takenAt?: string;
  caption?: string;
  tags?: string[];
  /**
   * A place name for a `location`-kind item, from a reverse-geocode lookup
   * — never typed by a person, never guessed by an agent. Absent when the
   * `addressLookup` capability is off, or the lookup found nothing.
   */
  location?: string;
  country?: string;
  countryCode?: string;
  /**
   * A named exception to "nothing on a sidecar is inferred" — B1573's
   * successor ticket. `"exif"` means `lat`/`lon`/`takenAt` came from the
   * photograph's own embedded metadata, a real measurement the camera took,
   * not a guess and not what the person said. Every reader that might
   * otherwise credit these fields to the uploader must check this first.
   */
  measuredFrom?: "exif";
  /**
   * Whether the conversation has already asked for a caption on this
   * photograph and been told no — mirrors `Entry.weatherAsked` exactly.
   * Absent means not asked yet; `caption` present means answered.
   */
  descriptionAsked?: boolean;
  source?: "whatsapp";
  receivedAt?: string;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/helper-room-files.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/inbox.ts test/helper-room-files.test.ts
git commit -m "B<id>: two new inbox kinds (location, contact), three new sidecar fields"
```

---

## Task 2: EXIF, read once, as a named exception

**Files:**
- Create: `lib/ingest/exif.ts`
- Test: `test/ingest-exif.test.ts`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Consumes: a raw image `Buffer` (whatever bytes arrived in the upload,
  before any resizing).
- Produces: `readExif(buffer: Buffer): Promise<{ lat?: number; lon?: number; takenAt?: string } | null>`
  — `null` when there is no EXIF, the file is not a format that carries it,
  or parsing throws. Task 3 is the only caller.

- [ ] **Step 1: Add the dependency**

```bash
npm install exifr
```

`exifr` is a small, actively maintained, GPS/date-aware EXIF parser; sharp
(already a dependency here) only exposes the raw EXIF buffer via
`.metadata()` and does not decode GPS or date tags itself.

- [ ] **Step 2: Write the failing test**

Create `test/ingest-exif.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { readExif } from "@/lib/ingest/exif";

describe("readExif", () => {
  test("bytes with no EXIF at all answer null, not a throw", async () => {
    const result = await readExif(Buffer.from("not an image"));
    expect(result).toBeNull();
  });

  test("a JPEG with GPS and DateTimeOriginal answers both", async () => {
    const { paintJpegWithExif } = await import("./support/pictures");
    const bytes = await paintJpegWithExif(40, 30, {
      lat: 46.5, lon: 7.9, takenAt: "2026-05-04T10:00:00.000Z",
    });
    const result = await readExif(bytes);
    expect(result?.lat).toBeCloseTo(46.5, 2);
    expect(result?.lon).toBeCloseTo(7.9, 2);
    expect(result?.takenAt).toBe("2026-05-04T10:00:00.000Z");
  });
});
```

`test/support/pictures.ts` already exists (used by
`test/helper-room-files.test.ts`'s own `paintJpeg` helper) — this task adds
one sibling function to it rather than a new file:

```ts
// In test/support/pictures.ts, alongside the existing paintJpeg:
import piexif from "piexifjs";

export async function paintJpegWithExif(
  width: number,
  height: number,
  gps: { lat: number; lon: number; takenAt: string },
): Promise<Buffer> {
  const plain = await paintJpeg(width, height, 1);
  const dataUrl = `data:image/jpeg;base64,${plain.toString("base64")}`;
  const toDMS = (deg: number) => {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const m = Math.floor((abs - d) * 60);
    const s = ((abs - d) * 60 - m) * 60 * 100;
    return [[d, 1], [m, 1], [Math.round(s), 100]];
  };
  const exifObj = {
    GPS: {
      [piexif.GPSIFD.GPSLatitude]: toDMS(gps.lat),
      [piexif.GPSIFD.GPSLatitudeRef]: gps.lat >= 0 ? "N" : "S",
      [piexif.GPSIFD.GPSLongitude]: toDMS(gps.lon),
      [piexif.GPSIFD.GPSLongitudeRef]: gps.lon >= 0 ? "E" : "W",
    },
    Exif: {
      [piexif.ExifIFD.DateTimeOriginal]: gps.takenAt
        .slice(0, 19).replace("T", " ").replace(/-/g, ":"),
    },
  };
  const inserted = piexif.insert(piexif.dump(exifObj), dataUrl);
  return Buffer.from(inserted.split(",")[1], "base64");
}
```

This needs `piexifjs` as a second new dev dependency (writing test-fixture
EXIF is a different job than reading it in production, so a separate,
test-only library is the right split — `piexifjs` has no GPS-reading
counterpart as good as `exifr`'s, which is why production reads with one
library and the fixture writes with another):

```bash
npm install --save-dev piexifjs @types/piexifjs
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/ingest-exif.test.ts`
Expected: FAIL — `lib/ingest/exif.ts` does not exist yet.

- [ ] **Step 4: Write the minimal implementation**

Create `lib/ingest/exif.ts`:

```ts
import "server-only";
import exifr from "exifr";

/**
 * GPS and capture time out of a photograph's own embedded metadata — a
 * named, sourced exception to `lib/inbox.ts`'s "nothing on a sidecar is
 * inferred" rule. The camera measured this; nobody guessed it. Every caller
 * must tag what it writes with `measuredFrom: "exif"` so a later reader can
 * tell it apart from what a person said.
 *
 * Never throws — a corrupt file, a format `exifr` cannot read, or a
 * photograph with no location data are all the same "nothing to add" to
 * the caller, exactly like `reversePlace`'s own "null is a failure"
 * contract in `lib/addressLookup.ts`.
 */
export async function readExif(
  bytes: Buffer,
): Promise<{ lat?: number; lon?: number; takenAt?: string } | null> {
  try {
    const [gps, dates] = await Promise.all([
      exifr.gps(bytes).catch(() => undefined),
      exifr.parse(bytes, ["DateTimeOriginal"]).catch(() => undefined),
    ]);
    const lat = gps?.latitude;
    const lon = gps?.longitude;
    const takenAt =
      dates?.DateTimeOriginal instanceof Date
        ? dates.DateTimeOriginal.toISOString()
        : undefined;
    if (lat === undefined && lon === undefined && takenAt === undefined) return null;
    return {
      ...(lat !== undefined ? { lat } : {}),
      ...(lon !== undefined ? { lon } : {}),
      ...(takenAt !== undefined ? { takenAt } : {}),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/ingest-exif.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/ingest/exif.ts test/ingest-exif.test.ts test/support/pictures.ts package.json package-lock.json
git commit -m "B<id>: read GPS and capture time out of a photograph's own EXIF"
```

---

## Task 3: Wire EXIF and reverse-geocoding into the upload door

**Files:**
- Modify: `lib/inboxUpload.ts` (`receiveInboxUpload`)
- Test: `test/inbox-upload-route.test.ts` (create if no direct test of
  `receiveInboxUpload` exists — check first with `grep -rl receiveInboxUpload test/`)

**Interfaces:**
- Consumes: `readExif` (Task 2), `reversePlace` (existing,
  `lib/addressLookup.ts:383`), `isEnabled` (existing, `lib/capabilities.ts`).
- Produces: nothing new outside this file — the effect is purely in what
  `storeInboxFile` gets called with.

- [ ] **Step 1: No existing test drives `receiveInboxUpload` directly**

Confirmed (`grep -rl "receiveInboxUpload" test/` finds nothing) — create
`test/inbox-upload-route.test.ts` fresh, importing the `journal()`-style
fixture pattern from `test/helper-room-files.test.ts` (a `CONTENT_DIR`
temp dir with a `config.json` and a user folder) rather than duplicating a
third copy of it.

- [ ] **Step 2: Write the failing test**

```ts
test("a media upload with EXIF GPS gets lat/lon it never said, tagged measuredFrom exif", async () => {
  journal(); // existing fixture from whichever file this test lives in
  const { paintJpegWithExif } = await import("./support/pictures");
  const bytes = await paintJpegWithExif(40, 30, { lat: 46.5, lon: 7.9, takenAt: "2026-05-04T10:00:00.000Z" });
  const form = new FormData();
  form.set("files", new File([bytes], "hafen.jpg", { type: "image/jpeg" }));
  const response = await receiveInboxUpload("u", new Request("https://t.test/x", { method: "POST", body: form }));
  const body = (await response.json()) as { items: { lat?: number; measuredFrom?: string }[] };
  expect(body.items[0].lat).toBeCloseTo(46.5, 2);
  expect(body.items[0].measuredFrom).toBe("exif");
});

test("an explicitly-said lat/lon is never overwritten by EXIF", async () => {
  journal();
  const { paintJpegWithExif } = await import("./support/pictures");
  const bytes = await paintJpegWithExif(40, 30, { lat: 46.5, lon: 7.9, takenAt: "2026-05-04T10:00:00.000Z" });
  const form = new FormData();
  form.set("files", new File([bytes], "hafen.jpg", { type: "image/jpeg" }));
  form.set("meta", JSON.stringify({ lat: 1, lon: 1 }));
  const response = await receiveInboxUpload("u", new Request("https://t.test/x", { method: "POST", body: form }));
  const body = (await response.json()) as { items: { lat?: number; measuredFrom?: string }[] };
  expect(body.items[0].lat).toBe(1);
  expect(body.items[0].measuredFrom).toBeUndefined();
});

test("a location-kind item is reverse-geocoded when addressLookup is on", async () => {
  journal({ addressLookup: true });
  const form = new FormData();
  form.set("files", new File([Buffer.from(JSON.stringify({ lat: 46.02, lon: 7.75 }))], "location.json"));
  form.set("kind", "location");
  form.set("meta", JSON.stringify({ lat: 46.02, lon: 7.75 }));
  const response = await receiveInboxUpload("u", new Request("https://t.test/x", { method: "POST", body: form }));
  const body = (await response.json()) as { items: { location?: string }[] };
  // The provider is whatever this checkout's test config points `addressLookup` at —
  // assert only that the field was attempted, not a specific place name.
  expect("location" in body.items[0]).toBe(true);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run <the test file from step 1>`
Expected: FAIL — no EXIF or reverse-geocode call happens yet.

- [ ] **Step 4: Wire both into `receiveInboxUpload`**

In `lib/inboxUpload.ts`, add the imports:

```ts
import { readExif } from "./ingest/exif";
import { reversePlace } from "./addressLookup";
import { isEnabled } from "./capabilities";
```

After the `staged.push(...)` loop (where each file's `meta` is first
assembled) and before the `withStorageQuota` call, add:

```ts
for (const file of staged) {
  if (file.kind === "media") {
    if (file.meta.lat === undefined && file.meta.lon === undefined && file.meta.takenAt === undefined) {
      const exif = await readExif(file.bytes);
      if (exif) {
        file.meta = { ...file.meta, ...exif, measuredFrom: "exif" };
      }
    }
  }
  if (file.kind === "location" && isEnabled("addressLookup", user) && file.meta.lat !== undefined && file.meta.lon !== undefined) {
    const place = await reversePlace(file.meta.lat, file.meta.lon, journal.defaultLocale).catch(() => null);
    if (place) {
      file.meta = { ...file.meta, location: place.location, country: place.country, countryCode: place.countryCode };
    }
  }
}
```

`readExif` is only ever offered a chance to answer when nothing was said
explicitly (`lat`/`lon`/`takenAt` all absent from the caller's own `meta`) —
this is the "never overwrites what somebody said" rule from the second test
above, enforced structurally rather than by convention.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run <the test file>`
Expected: PASS

- [ ] **Step 6: Run the full inbox upload test suite to check nothing broke**

Run: `npx vitest run test/helper-room-files.test.ts test/inbox-route.test.ts test/helper-inbox-upload.test.ts`
Expected: PASS — these are the three existing files that exercise
`receiveInboxUpload`'s two callers; check their names first with
`ls test/ | grep -i inbox`, since exact filenames may differ slightly from
this guess.

- [ ] **Step 7: Commit**

```bash
git add lib/inboxUpload.ts test/<the test file>
git commit -m "B<id>: EXIF and reverse-geocoding on upload, only when nobody already said"
```

---

## Task 4: The browser's "share my current location" button

**Files:**
- Modify: `components/HelperAsk.tsx` (new prop, new button)
- Modify: `components/HelperRoom.tsx` (implements the capture + upload)
- Test: `test/helper-room.test.tsx`
- Modify: `site/locales/{en,de,hu}.json`

**Interfaces:**
- Produces: `HelperAsk`'s prop list grows `onShareLocation?: () => void`,
  rendered exactly beside `onOpenFiles` (`components/HelperAsk.tsx:1367-1376`).
- Consumes: `navigator.geolocation.getCurrentPosition` (browser API, no
  import); `POST /api/helper/<user>/inbox` (existing route, Task 1 already
  made it accept `kind=location`).

- [ ] **Step 1: Add the locale strings**

In `site/locales/en.json`, beside the existing `agent.room.*` keys:

```json
"agent.room.shareLocation": "Share your current location",
"agent.room.locationFailed": "Could not get your location. Check your browser's location permission and try again.",
```

In `site/locales/de.json`:

```json
"agent.room.shareLocation": "Aktuellen Standort teilen",
"agent.room.locationFailed": "Standort konnte nicht ermittelt werden. Prüfe die Standortfreigabe deines Browsers und versuche es erneut.",
```

In `site/locales/hu.json`:

```json
"agent.room.shareLocation": "Jelenlegi hely megosztása",
"agent.room.locationFailed": "A hely nem volt lekérhető. Ellenőrizd a böngésző helymeghatározási engedélyét, és próbáld újra.",
```

Then:

```bash
npm run i18n:keys
```

- [ ] **Step 2: Write the failing test**

Add to `test/helper-room.test.tsx` (which already has the full `render()`
harness and a `vi.stubGlobal("fetch", ...)` pattern from the existing
tests — reuse it, do not build a second harness):

```ts
test("the share-location button uploads the browser's own coordinate into the inbox", async () => {
  const getCurrentPosition = vi.fn((success: PositionCallback) => {
    success({ coords: { latitude: 46.02, longitude: 7.75 } } as GeolocationPosition);
  });
  vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/inbox")) {
        return {
          ok: true,
          json: async () => ({
            items: [{ id: "location:abc", kind: "location", name: "location.json", lat: 46.02, lon: 7.75 }],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, blocks: [] }) } as Response;
    }),
  );
  const box = render();
  const button = [...box.querySelectorAll("button")].find(
    (one) => one.getAttribute("aria-label") === "Share your current location",
  )!;
  expect(button).toBeDefined();
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(getCurrentPosition).toHaveBeenCalled();
  const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]: [string]) => url.endsWith("/inbox"));
  expect(call).toBeDefined();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/helper-room.test.tsx -t "share-location"`
Expected: FAIL — no such button exists yet.

- [ ] **Step 4: Add the prop and button to `HelperAsk.tsx`**

In the props destructuring near line 334 (beside `onOpenFiles`):

```ts
onOpenFiles,
onShareLocation,
```

In the type block near line 417:

```ts
onOpenFiles?: () => void;
/** The composer's own "share my current location" press — B1573's
 *  successor. Absent means the room has nothing to do with it yet. */
onShareLocation?: () => void;
```

Import the icon at the top of the file, beside the existing `Paperclip`
import:

```ts
import { MapPin, Paperclip } from "lucide-react";
```

Beside the existing paperclip button (`components/HelperAsk.tsx:1367-1376`):

```tsx
{onShareLocation && (
  <button
    type="button"
    onClick={onShareLocation}
    aria-label={t("agent.room.shareLocation")}
    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-navy-700 transition-colors hover:bg-navy-50 hover:text-navy-900"
  >
    <MapPin className="h-5 w-5" aria-hidden />
  </button>
)}
```

- [ ] **Step 5: Implement the capture + upload in `HelperRoom.tsx`**

Beside the existing `<HelperAsk ... onOpenFiles={...} />` call
(`components/HelperRoom.tsx:1266`), add a handler and wire it in:

```ts
/** The composer's own location button — captures the browser's current
 *  position and uploads it into the inbox exactly the way the files pane's
 *  own picker uploads a photograph, through the same door. */
function shareLocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      void (async () => {
        const form = new FormData();
        form.set(
          "files",
          new File([JSON.stringify({ lat: latitude, lon: longitude })], "location.json", {
            type: "application/json",
          }),
        );
        form.set("kind", "location");
        form.set("meta", JSON.stringify({ lat: latitude, lon: longitude }));
        const response = await fetch(`/api/helper/${encodeURIComponent(username)}/inbox`, {
          method: "POST",
          body: form,
        }).catch(() => null);
        const body = (await response?.json().catch(() => null)) as
          | { items?: { id: string; kind: string; name: string; lat?: number; lon?: number; location?: string }[] }
          | null;
        if (body?.items?.length) {
          setInbox((was) => [
            ...body.items!.map((item) => ({ id: item.id, name: item.location ?? item.name, src: undefined })),
            ...was,
          ]);
        }
      })();
    },
    () => {
      // Denied, or the browser could not answer — the permission prompt
      // itself already told them why; nothing here invents a reason.
    },
  );
}
```

Then pass `onShareLocation={shareLocation}` beside the existing
`onOpenFiles={() => setTab("files")}` at line 1266.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/helper-room.test.tsx -t "share-location"`
Expected: PASS

- [ ] **Step 7: Run the whole file to check nothing else broke**

Run: `npx vitest run test/helper-room.test.tsx`
Expected: PASS (all tests, not only the new one)

- [ ] **Step 8: Commit**

```bash
git add components/HelperAsk.tsx components/HelperRoom.tsx test/helper-room.test.tsx site/locales/en.json site/locales/de.json site/locales/hu.json lib/i18n.ts
git commit -m "B<id>: a composer button that shares the browser's current location into the inbox"
```

---

## Task 5: Location and contact items get their own icon

**Files:**
- Modify: `components/InboxFileGroups.tsx`
- Test: `test/inbox-file-groups.test.tsx`

**Interfaces:**
- Consumes: `InboxFile.kind` — currently `"photo" | "video" | "document"`
  (see the file's own mapping in `components/HelperRoom.tsx`'s
  `filesPane`, where an inbox `InboxKind` collapses to one of these three
  before reaching `InboxFileGroups`). This task adds two more:
  `"location" | "contact"`.
- Produces: nothing new consumed elsewhere — purely the icon/grouping.

- [ ] **Step 1: Add the new group's heading string**

`site/locales/en.json`: `"agent.room.otherFiles": "Other"`
`site/locales/de.json`: `"agent.room.otherFiles": "Sonstiges"`
`site/locales/hu.json`: `"agent.room.otherFiles": "Egyéb"`

```bash
npm run i18n:keys
```

- [ ] **Step 2: Write the failing test**

Add to `test/inbox-file-groups.test.tsx` (which already has a `render()`
harness taking `InboxFile[]`):

```ts
describe("a location or contact item", () => {
  test("renders its own icon rather than the generic document one", () => {
    const el = render([
      { id: "inbox:a", name: "Zermatt", kind: "location", at: NEW },
      { id: "inbox:b", name: "maria.vcf", kind: "contact", at: NEW },
    ]);
    expect(el.textContent).toContain("Zermatt");
    expect(el.textContent).toContain("maria.vcf");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/inbox-file-groups.test.tsx`
Expected: FAIL — `InboxFile["kind"]` does not accept `"location"`/`"contact"`
yet, so this will not compile.

- [ ] **Step 4: Widen the type and add the icons**

`components/InboxFileGroups.tsx:34` has the private type
`InboxFileKind = "photo" | "video" | "document"`. Widen it:

```ts
type InboxFileKind = "photo" | "video" | "document" | "location" | "contact";
```

`KindIcon` (`components/InboxFileGroups.tsx:65-68`) today is:

```tsx
function KindIcon({ kind }: { kind: InboxFileKind }) {
  if (kind === "video") return <span aria-hidden>🎞️</span>;
  return <FileText className="h-5 w-5 text-navy-600" aria-hidden />;
}
```

Add the two new cases before the `FileText` fallback:

```tsx
function KindIcon({ kind }: { kind: InboxFileKind }) {
  if (kind === "video") return <span aria-hidden>🎞️</span>;
  if (kind === "location") return <MapPin className="h-5 w-5 text-navy-600" aria-hidden />;
  if (kind === "contact") return <Contact className="h-5 w-5 text-navy-600" aria-hidden />;
  return <FileText className="h-5 w-5 text-navy-600" aria-hidden />;
}
```

Add the two imports beside the existing `FileText` import at the top of the
file:

```ts
import { Contact, FileText, MapPin } from "lucide-react";
```

The component's own `photos`/`documents` split
(`const photos = newestFirst(files.filter((f) => f.kind === "photo" || f.kind === "video"))`,
`const documents = newestFirst(files.filter((f) => f.kind === "document"))`
— read the exact lines near the top of the exported `InboxFileGroups`
function) needs a third bucket rather than folding `location`/`contact`
into `documents`, since `KindIcon` now tells them apart and the heading
should too:

```ts
const photos = newestFirst(files.filter((f) => f.kind === "photo" || f.kind === "video"));
const documents = newestFirst(files.filter((f) => f.kind === "document"));
const other = newestFirst(files.filter((f) => f.kind === "location" || f.kind === "contact"));
```

Render `other` with the same row markup the `documents` group already uses
(`components/InboxFileGroups.tsx:167-209`, the `<ul className="mt-2
space-y-1">` block with a checkbox `<label>` per row) — copy that block's
JSX once more under its own heading (`t("agent.room.otherFiles")`, the key
Step 1 added), rather than merging it into the `documents` block, so
location/contact items are visually and structurally their own group.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/inbox-file-groups.test.tsx`
Expected: PASS

- [ ] **Step 6: Update the room's own kind-collapsing map**

In `components/HelperRoom.tsx`, the `filesPane`'s `InboxFileGroups` caller
collapses `InboxEntry.kind` (`"media" | "files" | "photobook" |
"postcards" | "location" | "contact"`) into the three/five-way
`InboxFile["kind"]`. Find the line (currently something like
`kind: file.kind === "media" ? (VIDEO.test(file.name) ? "video" : "photo") : "document"`)
and widen it:

```ts
kind:
  file.kind === "media" ? (VIDEO.test(file.name) ? "video" : "photo")
  : file.kind === "location" ? "location"
  : file.kind === "contact" ? "contact"
  : "document",
```

- [ ] **Step 7: Run the full HelperRoom test file**

Run: `npx vitest run test/helper-room.test.tsx test/inbox-file-groups.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add components/InboxFileGroups.tsx components/HelperRoom.tsx test/inbox-file-groups.test.tsx site/locales/en.json site/locales/de.json site/locales/hu.json lib/i18n.ts
git commit -m "B<id>: location and contact inbox items get their own icon"
```

---

## Task 6: WhatsApp location pins land in the inbox, not on a day automatically

**Files:**
- Modify: `lib/whatsapp/dispatch.ts` (`handleLocationPin`, `lib/whatsapp/dispatch.ts:628`)
- Modify: `test/whatsapp-location-contact.test.ts` (rewrite the four
  location-pin test cases; this is an intentional behavior change on a
  shipped feature, B1074 — read the existing four tests first, in full,
  before touching them)

**Interfaces:**
- Consumes: `storeInboxFile` (Task 1's widened `InboxKind`).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Read the four existing tests in full**

```bash
sed -n '110,183p' test/whatsapp-location-contact.test.ts
```

These four (`with a trip covering that date creates a draft day...`, `with
no trip covering that date is refused...`, `on a date that already has a
day attaches...`, `with two trips covering the date, the most recently
created wins`) all assert the *old*, auto-attaching behavior. They are
being replaced, not extended.

- [ ] **Step 2: Write the new failing tests, replacing the old four**

Replace the `describe("a location pin", ...)` block
(`test/whatsapp-location-contact.test.ts:110-183`) with:

```ts
describe("a location pin", () => {
  test("lands in the inbox rather than attaching to any day automatically", async () => {
    const username = "loc1";
    await bindGreetAcknowledge(username, "+41000000001");
    writeTrip(username, "trip", "2026-01-01", "2026-01-31");
    await handleInboundMessage(locationMessage("+41000000001", "wamid.loc1.pin", "1767225600"));
    // 1767225600 = 2026-01-01T00:00:00Z, inside the trip above.
    const days = getDays(tripRef(username, "trip"), AS_AUTHOR);
    expect(days).toHaveLength(0); // nothing created on any day

    const { listInbox } = await import("@/lib/inbox");
    const staged = listInbox(username).location;
    expect(staged).toHaveLength(1);
    expect(staged[0].lat).toBeCloseTo(46.5, 1);
    expect(staged[0].lon).toBeCloseTo(7.9, 1);
    expect(staged[0].source).toBe("whatsapp");

    const replies = repliesTo(username);
    expect(replies.some((r) => JSON.stringify(r).includes("saved") || JSON.stringify(r).includes("waiting"))).toBe(true);
  });
});
```

(The exact reply-sentence assertion in the last line is a placeholder for
"say something honest happened" — Step 4 below writes the real locale
string this checks against; tighten this assertion to that exact string
once it exists, rather than the loose substring check above.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/whatsapp-location-contact.test.ts`
Expected: FAIL — `handleLocationPin` still auto-attaches.

- [ ] **Step 4: Add the reply locale string**

`site/locales/en.json`:

```json
"wa.locationSaved": "Got it — saved, waiting for you to say which day it's for.",
```

`site/locales/de.json`:

```json
"wa.locationSaved": "Erhalten — gespeichert, und wartet darauf, dass du sagst, zu welchem Tag es gehört.",
```

`site/locales/hu.json`:

```json
"wa.locationSaved": "Megkaptam — elmentve, és arra vár, hogy megmondd, melyik naphoz tartozik.",
```

```bash
npm run i18n:keys
```

Now tighten the test from Step 2 to assert the real string:

```ts
expect(replies.some((r) => JSON.stringify(r).includes("Got it — saved"))).toBe(true);
```

- [ ] **Step 5: Rewrite `handleLocationPin`**

Replace the body of `handleLocationPin` (`lib/whatsapp/dispatch.ts:628-729`,
the whole function up to its closing brace before `handleContactCard`)
with:

```ts
async function handleLocationPin(
  username: string,
  locale: string,
  message: Extract<InboundMessage, { kind: "location" }>,
): Promise<void> {
  const { storeInboxFile } = await import("../inbox");
  storeInboxFile(
    username,
    "location",
    `location-${message.timestamp}.json`,
    Buffer.from(JSON.stringify({ lat: message.latitude, lon: message.longitude })),
    {
      lat: message.latitude,
      lon: message.longitude,
      source: "whatsapp",
      receivedAt: new Date((Number(message.timestamp) || Date.now() / 1000) * 1000).toISOString(),
    },
  );
  await sendServiceReply(message.from, translateIn(locale, "wa.locationSaved"), username);
}
```

Remove now-unused imports this function no longer needs (`tripForDate`,
`reversePlace`, `tripRef`, `getAllEntries`, `editEntry`, `wrote`, `DraftInput`,
`NO_PROSE`, `UNKNOWN` — check each with `grep -n` before deleting; some are
still used by `handleContactCard` or other functions in the same file and
must stay).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/whatsapp-location-contact.test.ts`
Expected: PASS

- [ ] **Step 7: Run the file's full suite plus a broader WhatsApp check**

Run: `npx vitest run test/whatsapp-location-contact.test.ts test/whatsapp-new-chat.test.ts test/whatsapp-model-turn.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/whatsapp/dispatch.ts test/whatsapp-location-contact.test.ts site/locales/en.json site/locales/de.json site/locales/hu.json lib/i18n.ts
git commit -m "B<id>: a WhatsApp location pin lands in the inbox instead of auto-attaching to a day"
```

---

## Task 7: WhatsApp contact cards land in the inbox; inviting becomes a deliberate press

**Files:**
- Create: `lib/whatsapp/vcard.ts`
- Modify: `lib/whatsapp/dispatch.ts` (`handleContactCard`)
- Modify: `lib/helper/tools/areas/files.ts` (new `invite_contact` tool)
- Modify: `test/whatsapp-location-contact.test.ts` (rewrite the two
  contact-card test cases)
- Test: `test/whatsapp-vcard.test.ts`

**Interfaces:**
- Produces: `toVCard(contact: { name?: string; phones?: string[]; emails?: string[] }): string`
  — Task 7's own new function, consumed only by `handleContactCard` in this
  same task.
- Consumes: `storeInboxFile` (Task 1); `createInvite` (existing, already
  imported by `handleContactCard` today — stays, moves to the new tool).

- [ ] **Step 1: Write the vCard serialiser test**

Create `test/whatsapp-vcard.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { toVCard } from "@/lib/whatsapp/vcard";

describe("toVCard", () => {
  test("a name, a phone and an email become a minimal vCard", () => {
    const text = toVCard({ name: "Maria", phones: ["+41791234567"], emails: ["maria@example.test"] });
    expect(text).toContain("BEGIN:VCARD");
    expect(text).toContain("FN:Maria");
    expect(text).toContain("TEL:+41791234567");
    expect(text).toContain("EMAIL:maria@example.test");
    expect(text).toContain("END:VCARD");
  });

  test("nothing given is still a well-formed, empty card", () => {
    const text = toVCard({});
    expect(text).toContain("BEGIN:VCARD");
    expect(text).toContain("END:VCARD");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/whatsapp-vcard.test.ts`
Expected: FAIL — `lib/whatsapp/vcard.ts` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/whatsapp/vcard.ts`:

```ts
/**
 * A shared WhatsApp contact, restated as a minimal vCard — B1573's
 * successor. Nothing here is invented: every line is a field the message
 * already carried (`lib/whatsapp/inbound.ts`'s own `contacts` parsing),
 * restructured into the standard format `storeInboxFile` can hold as
 * ordinary bytes.
 */
export function toVCard(contact: { name?: string; phones?: string[]; emails?: string[] }): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  if (contact.name) lines.push(`FN:${contact.name}`);
  for (const phone of contact.phones ?? []) lines.push(`TEL:${phone}`);
  for (const email of contact.emails ?? []) lines.push(`EMAIL:${email}`);
  lines.push("END:VCARD");
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/whatsapp-vcard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the vCard helper**

```bash
git add lib/whatsapp/vcard.ts test/whatsapp-vcard.test.ts
git commit -m "B<id>: serialise a parsed WhatsApp contact into a minimal vCard"
```

- [ ] **Step 6: Read the two existing contact-card tests in full**

```bash
sed -n '184,210p' test/whatsapp-location-contact.test.ts
```

- [ ] **Step 7: Write the new failing tests, replacing the old two**

Replace `describe("a shared contact card", ...)`
(`test/whatsapp-location-contact.test.ts:184-210`) with:

```ts
describe("a shared contact card", () => {
  test("lands in the inbox rather than inviting anyone automatically", async () => {
    const username = "con1";
    await bindGreetAcknowledge(username, "+41000000002");
    await handleInboundMessage(
      contactsMessage("+41000000002", "wamid.con1.card", [
        { name: "Maria", emails: ["maria@example.test"] },
      ]),
    );
    const { listInbox } = await import("@/lib/inbox");
    const staged = listInbox(username).contact;
    expect(staged).toHaveLength(1);
    expect(staged[0].source).toBe("whatsapp");

    const { getContactByEmail } = await import("@/lib/contacts");
    const contact = await getContactByEmail(username, "maria@example.test");
    expect(contact).toBeNull(); // no invite made — that is now a deliberate press
  });

  test("with no email still stages the card — the invite-time refusal moves to the new press", async () => {
    const username = "con2";
    await bindGreetAcknowledge(username, "+41000000003");
    await handleInboundMessage(
      contactsMessage("+41000000003", "wamid.con2.card", [{ name: "NoEmail" }]),
    );
    const { listInbox } = await import("@/lib/inbox");
    expect(listInbox(username).contact).toHaveLength(1);
  });
});
```

`getContactByEmail` lives in `lib/contacts/index.ts:752` (imported as
`@/lib/contacts`, its own `index.ts`) and returns `Promise<ContactRecord |
null>` — `null` for "no such contact," confirmed, so the assertion above is
exact as written.

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run test/whatsapp-location-contact.test.ts`
Expected: FAIL — `handleContactCard` still auto-invites.

- [ ] **Step 9: Rewrite `handleContactCard`**

Replace the body of `handleContactCard`
(`lib/whatsapp/dispatch.ts:732-760`) with:

```ts
async function handleContactCard(
  username: string,
  locale: string,
  message: Extract<InboundMessage, { kind: "contacts" }>,
): Promise<void> {
  const { storeInboxFile } = await import("../inbox");
  const { toVCard } = await import("./vcard");
  for (const contact of message.contacts) {
    storeInboxFile(
      username,
      "contact",
      `${(contact.name ?? "contact").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.vcf`,
      Buffer.from(toVCard(contact)),
      { source: "whatsapp", receivedAt: new Date().toISOString() },
    );
  }
  await sendServiceReply(message.from, translateIn(locale, "wa.contactSaved"), username);
}
```

Add the locale string, all three languages, same pattern as Task 6 Step 4:

`site/locales/en.json`: `"wa.contactSaved": "Got it — saved. Ask me to invite them as a guest whenever you're ready."`
`site/locales/de.json`: `"wa.contactSaved": "Erhalten — gespeichert. Sag mir Bescheid, wenn ich sie als Gast einladen soll."`
`site/locales/hu.json`: `"wa.contactSaved": "Megkaptam — elmentve. Szólj, ha meghívnám vendégként."`

```bash
npm run i18n:keys
```

Check `createInvite`/`isEmail`/`inviteLinkUrl` imports at the top of
`lib/whatsapp/dispatch.ts` — remove them if `handleContactCard` was their
only caller in this file (`grep -n "createInvite\|isEmail\|inviteLinkUrl" lib/whatsapp/dispatch.ts`).

- [ ] **Step 10: Run test to verify it passes**

Run: `npx vitest run test/whatsapp-location-contact.test.ts`
Expected: PASS

- [ ] **Step 11: Add the deliberate-invite tool**

In `lib/helper/tools/areas/files.ts`, add a new tool beside `attach_files`
(matching its `propose`/`confirm` shape exactly — read `attach_files` in
full first, `lib/helper/tools/areas/files.ts:93-203`, since this tool
copies its proposal structure):

```ts
{
  /**
   * A shared contact, waiting in the inbox, invited as a guest on
   * request — B1573's successor. The invite used to happen automatically
   * the moment a contact card arrived; now it is a press like any other
   * write in this family, same as `attach_files` never uploads and never
   * decides on its own which files move.
   */
  name: "invite_contact",
  kind: "write",
  renders: "confirm",
  describe:
    "Propose inviting a contact waiting in the inbox as a guest — \"invite Maria\", \"send her a guest link\". Needs the contact to have an email; say so if it does not.",
  properties: {
    contact: { type: "string", description: "The inbox id of the contact, or their name." },
  },
  endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/invite-contact`,
  propose: async (username, args, say, _today, _selected) => {
    const { listInbox, findInboxFile } = await import("../../../inbox");
    const asked = (args.contact ?? "").trim();
    const staged = findInboxFile(username, asked)?.entry
      ?? Object.values(listInbox(username)).flat().find((e) => e.kind === "contact" && e.filename.toLowerCase().includes(asked.toLowerCase()));
    if (!staged || staged.kind !== "contact") {
      return { sentence: "", fields: [], accept: "", done: "", refuse: say("agent.tool.inviteContactNotFound") };
    }
    return {
      sentence: say("agent.tool.inviteContact", { name: staged.filename.replace(/\.vcf$/, "") }),
      accept: say("agent.tool.inviteContactAccept"),
      done: say("agent.tool.inviteContactDone"),
      preview: [staged.filename],
      fields: [{ name: "contact", value: staged.id, fixed: true }],
    };
  },
},
```

Add the three new proposal-copy locale keys (`agent.tool.inviteContact`,
`agent.tool.inviteContactAccept`, `agent.tool.inviteContactDone`,
`agent.tool.inviteContactNotFound`) to all three locale files, following the
existing `agent.tool.attachFiles*` keys immediately above them as the
pattern to match in tone. Then `npm run i18n:keys`.

Create `app/api/helper/[user]/invite-contact/route.ts`, the same
cookie-only, owner-only shape every route in this family takes
(`app/api/helper/[user]/day/attach/route.ts` is the closest sibling —
`isHelperOwner`/`notYourJournal` guard, `refused`/`wrote` on the outcome):

```ts
import fs from "node:fs";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { findInboxFile } from "@/lib/inbox";
import { createInvite, inviteLinkUrl } from "@/lib/contacts/invites";
import { serverSite } from "@/lib/site";
import { requestLocale } from "@/lib/locales";

export const dynamic = "force-dynamic";

/**
 * The deliberate press that replaces what a shared WhatsApp contact card
 * used to do automatically — B1573's successor. The contact has been
 * sitting in the inbox (`handleContactCard`, `lib/whatsapp/dispatch.ts`)
 * since it arrived; this is the only thing that turns it into a guest
 * invite, and it never happens without this press.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/invite-contact">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const id = String(body.contact ?? "").trim();
  const staged = findInboxFile(user, id);
  if (!staged || staged.entry.kind !== "contact") {
    refused(user, "invite_contact", "unknown_contact");
    return Response.json({ error: "unknown_contact" }, { status: 404 });
  }

  const text = fs.readFileSync(staged.file, "utf8");
  const name = /FN:(.+)/.exec(text)?.[1]?.trim();
  const email = /EMAIL:(.+)/.exec(text)?.[1]?.trim();
  if (!email) {
    refused(user, "invite_contact", "no_email");
    return Response.json({ error: "no_email" }, { status: 400 });
  }

  const locale = await requestLocale();
  const created = await createInvite(user, { kind: "guest", name, locale, email });
  const url = inviteLinkUrl(serverSite().url, user, "guest", created.token);

  wrote(user, "invite_contact", { contact: id, email });
  return Response.json({ ok: true, url }, { status: 201 });
}
```

`requestLocale()` (`lib/locales.ts:455`) is already used inside route
handlers in this same family — `app/api/helper/[user]/ask/route.ts`,
`.../day/route.ts` among them — so it needs no adaptation here.

- [ ] **Step 12: Run the whole test suite touched by this task**

Run: `npx vitest run test/whatsapp-location-contact.test.ts test/whatsapp-vcard.test.ts test/helper-tools.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add lib/whatsapp/dispatch.ts lib/helper/tools/areas/files.ts app/api/helper/\[user\]/invite-contact/ site/locales/en.json site/locales/de.json site/locales/hu.json lib/i18n.ts test/whatsapp-location-contact.test.ts
git commit -m "B<id>: a shared contact lands in the inbox; inviting them is now its own deliberate press"
```

---

## Final check

- [ ] Run `npm run verify` in full (build → tsc → eslint → vitest → knip).
- [ ] Re-read `test/helper-routes.test.ts`'s route census
  (`there are forty-X of them, and each is guarded`) — Task 7 added
  `invite-contact` as a new `app/api/helper/**` route; bump the count and
  its comment, the same convention every prior route addition there
  follows.
- [ ] `test-in-a-browser` the new composer button at 390px: sign in as an
  owner, open `/agent`, confirm the location pin icon appears beside the
  paperclip and that pressing it (with the browser's location permission
  granted) adds a tile to "Dateien."
