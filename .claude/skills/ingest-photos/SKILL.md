---
name: ingest-photos
description: Turn a folder of camera photos and clips into dated, geotagged Fernscout entries with sized galleries. Use when the user points at a folder, an SD card, a phone export or an iCloud album and says "import these", "add these photos", "ingest", or hands over a day's pictures.
---

# Ingest photos

```bash
npm run ingest -- --user <username> --trip <trip-id> <folder>
```

That is the whole thing. It reads EXIF, groups the files into days and places,
names the place from an offline index, writes web derivatives with **all**
metadata stripped, and writes the markdown. No network call anywhere in the
path — the evening you most want to write up the day is the evening the wifi
does not work.

Reference: `docs/ingest.md`.

## When to use this instead of `add-a-day`

If photographs exist, always start here. Ingest gets the date, the time, the
coordinates, the place name and the gallery dimensions right from the files;
doing that by hand is slow and wrong. Write the prose afterwards, into the entry
ingest created.

## Steps

### 1. Check the trip exists

```bash
ls content/<user>/trips/
```

Ingest **will not invent a trip.** If there is no folder, use the `add-a-trip`
skill first.

### 2. Check the optional tools

```bash
npm run ingest -- --tools
```

- **`ffmpeg` / `ffprobe`** — needed for video. Without them clips are skipped
  by name and the photographs in the same folder still import.
- **A HEIC decoder** (`heif-convert`, macOS `sips`, or ffmpeg 7+) — sharp's
  libvips can open a HEIC container but cannot decode HEVC pixels. Exporting
  JPEG from Photos.app avoids the problem entirely.

### 3. Dry run

```bash
npm run ingest -- --user <user> --trip <trip-id> ~/Desktop/staging --dry-run
```

Read what it plans: how many entries, which dates, which places. If it wants to
make one entry out of what was really two days in two towns, tune it rather than
fixing markdown afterwards:

| Flag | Default | Use when |
| --- | --- | --- |
| `--gap-hours <n>` | 5 | A long lunch split one day into two entries |
| `--split-km <n>` | 30 | Moving around a city split it up |
| `--tags a,b` | | Every entry from this batch shares a tag |
| `--max-edge <px>` | 2000 | Bigger images are wanted |
| `--format webp` | jpeg | Smaller files |

### 4. Drop the day's notes in next to the photos

Any `.md` or `.txt` in the folder becomes the entry's prose. Named after the day
— `2026-08-14.md` — it lands on that day's entry. **This is the fastest write-up
there is**: type the day into a note on the phone, drop it beside the pictures,
run one command.

### 5. Run it

```bash
npm run ingest -- --user <user> --trip <trip-id> ~/Desktop/staging
```

Safe to run twice. Every imported file is recorded in
`content/<user>/trips/<trip-id>/.ingest.json` by checksum **and** by perceptual
hash, so a re-export of the same photo at a different size is recognised too.
New photographs from a day that already has an entry are appended to that
entry's gallery by a textual edit — your prose, title and captions survive.

### 6. Read the result, then write the words

```bash
ls content/<user>/trips/<trip-id>/entries/ | tail -5
cat content/<user>/trips/<trip-id>/entries/<new-file>.md
```

Fill in the prose using the `add-a-day` skill's rules: the author's voice, the
author's language, and **nothing you were not told**. A photograph is not a
memory — do not narrate what you think it shows.

Every entry ingest writes carries `status: draft`, so nothing you import is on
the site yet. Leave the line there. Write the words under it and tell them it
is ready.

**Do not offer to publish, even though the network door does** — see the same
note in `add-a-day`. An import is the case where it matters most: it is a
batch, nobody has looked at any of it, and the photographs are the part you
were least able to check.

## The iCloud path

Photos.app does not give you a folder; `osxphotos` does:

```sh
osxphotos export ~/Desktop/staging \
  --album "Japan 2027" \
  --download-missing --use-photokit \
  --skip-original-if-edited \
  --convert-to-jpeg --jpeg-quality 1.0 \
  --exiftool \
  --update
```

`--exiftool` is the one that matters: Photos.app keeps location in its own
database, and without it the exported files carry no coordinates and ingest
cannot name the place.

## Privacy, which is not optional

Served derivatives carry **no metadata at all** — people photograph their own
front door, and a phone writes the coordinates of it into the file.
`test/ingest-media.test.ts` fails the build if GPS ever survives into an output.
Coordinates live in frontmatter instead, where they can be seen and deleted.

Set `MEDIA_ORIGINALS_DIR` to a path outside `content/` to keep untouched
originals somewhere no route can reach.
