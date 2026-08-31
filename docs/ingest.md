# Ingest — photos and clips into an entry

```
npm run ingest -- --user <username> --trip <tripId> <folder>
```

A folder of camera files becomes a dated, geotagged, editable entry. The
target is a stopwatch, not a feature list: **if writing up a day takes more
than about ten minutes, the blog is abandoned by month two.** Everything below
serves that, which is why the command asks no questions — it makes its best
guess, writes markdown you can edit, and gets out of the way.

Measured on a 2026 laptop: **30 photographs at 12 megapixels (137 MB) → two
entries in 13 seconds**, leaving the whole ten minutes for the words. A second
run over the same folder takes two seconds and changes nothing.

There is no network call anywhere in this path, reverse geocoding included.
The evening you most want to write up the day is the evening the wifi does not
work.

## What it does

1. **Reads EXIF** — capture time, GPS, orientation, camera — with a
   dependency-free parser (`lib/ingest/exif.ts`) that understands JPEG, HEIC
   and WebP.
2. **Groups the files** into candidate entries: a new calendar date always
   starts one, and within a day a long gap in time or a real change of place
   does too.
3. **Names the place** from a bundled offline copy of GeoNames.
4. **Writes web derivatives** at up to 2000 px, with the orientation baked
   into the pixels and **every scrap of metadata removed**.
5. **Writes the markdown** with date, time, location, country, coordinates and
   a gallery with width and height on every item.
6. **Remembers what it has imported**, so running it twice changes nothing.

## Options

| Flag | Default | What it is for |
| --- | --- | --- |
| `--dry-run` | | Work everything out, write nothing. |
| `--force` | | Import files the trip has already seen. |
| `--gap-hours <n>` | 5 | Hours of silence that start a new entry within a day. |
| `--split-km <n>` | 30 | Distance from a stop's centre that starts a new entry. |
| `--max-edge <px>` | 2000 | Longest edge of a served image. |
| `--format <jpeg\|webp>` | jpeg | Derivative format. |
| `--quality <n>` | 82 / 80 | Encoder quality. |
| `--max-video-seconds <n>` | 30 | Hard cap on clip length. |
| `--tags a,b,c` | | Tags added to every entry created. |
| `--tools` | | Report which optional tools are available, and exit. |

### Notes files

Any `.md` or `.txt` in the folder becomes the entry's prose. Name it after the
day — `2026-08-14.md` — and it lands on that day's entry. Typing the day into
a note on your phone and dropping it next to the photos is the fastest
write-up there is.

## Privacy: what reaches the internet

**Served derivatives carry no metadata at all.** A photograph straight off a
phone contains the coordinates of wherever it was taken, and people photograph
their own front door. The coordinates belong in frontmatter, where you can see
them and delete them — not silently inside a file anyone can download.

The colour profile is the single exception, because dropping it turns a
wide-gamut photo into a lurid one and a colour profile identifies nobody.
`test/ingest-media.test.ts` fails the build if GPS ever survives into an
output file.

Set `MEDIA_ORIGINALS_DIR` to keep the untouched originals — GPS and all —
somewhere outside `content/`, where no route can reach them:

```
MEDIA_ORIGINALS_DIR=/srv/fernscout-originals
```

Leave it unset and the originals stay wherever you already keep them; only
derivatives are written.

## Duplicates

You will import the same folder twice. Every file that has been imported is
recorded in `content/<user>/trips/<trip>/.ingest.json` by checksum and by
perceptual hash, so:

- the identical file is recognised by its checksum;
- a **re-export** — the same photograph at a different size or quality, which
  is what osxphotos or a messaging app hands you — is recognised by its
  difference hash.

New photographs from a day that already has an entry are appended to that
entry's gallery, and the file is edited textually so your prose, your title
and your captions survive untouched.

## Video

Short clips only. A travel blog gets ten seconds of a night market from video
and nothing at all from a four-minute 4K clip, which costs 200 MB of disk and
the reader's mobile data.

- Hard cap of 30 seconds. Longer clips are refused by name with the number in
  the message; nothing is ever served raw.
- Transcoded to h264/AAC in an MP4 at up to 1280 px, `+faststart`, with all
  container metadata stripped (phones write GPS there too).
- A poster frame is grabbed a second in and recorded as `poster:` in the
  gallery item.

This needs `ffmpeg` and `ffprobe` on `PATH`. Without them the clips are
skipped with a message and **the photographs in the same folder still
import** — losing an evening's write-up to a missing codec is exactly the
failure this package exists to prevent.

## HEIC

**sharp's prebuilt libvips can read a HEIC container but cannot decode it.**
Verified against sharp 0.35.4 / libvips 8.18.6 / libheif 1.23.2: the AV1
decoder is compiled in (so `.avif` works) and the HEVC one is not, for patent
licensing reasons. `sharp("x.heic").metadata()` succeeds and reports the right
dimensions; the first actual pixel fails with *"Support for this compression
format has not been built in"*. Metadata is therefore not a usable test for
whether a file can be read — ingest decides by attempting a decode.

When sharp cannot decode a file, ingest shells out to the first of these it
finds, converting to PNG (which cannot carry EXIF, so there is no orientation
tag left to apply twice and no GPS to carry forward):

1. `heif-convert` — `brew install libheif` / `apt install libheif-examples`
2. `sips` — built into macOS
3. `ffmpeg` 7 or newer

The EXIF is read from the original HEIC either way, by our own parser, so the
coordinates survive the conversion even though the pixels take a detour.

If none is available, ingest says so and names all three. Exporting JPEG
instead of HEIC — see the recipe below — also solves it.

## The iCloud path: `osxphotos`

Photos.app does not give you a folder. [`osxphotos`](https://github.com/RhetTbull/osxphotos)
does:

```sh
brew install osxphotos      # or: pipx install osxphotos

osxphotos export ~/Desktop/staging \
  --album "Vietnam 2026" \
  --download-missing --use-photokit \
  --skip-original-if-edited \
  --convert-to-jpeg --jpeg-quality 1.0 \
  --exiftool \
  --update

npm run ingest -- --user <username> --trip <tripId> ~/Desktop/staging
```

Every flag earns its place:

- `--album` — export one album, which is how you decide what the day was.
- `--download-missing --use-photokit` — with iCloud "Optimise Mac Storage" the
  full-resolution file is not on the disk. Without this you export thumbnails.
- `--skip-original-if-edited` — you want the version you cropped, not the one
  the camera produced.
- `--convert-to-jpeg` — sidesteps HEIC entirely. Drop it if you have a decoder
  installed and would rather keep the originals as they are.
- `--exiftool` — **the important one.** Photos.app keeps location and edits in
  its own database; an exported file does not carry them unless osxphotos
  writes them back in. Without this the photographs arrive with no
  coordinates and ingest cannot name the place.
- `--update` — a second export only writes what changed.

Ingest's own duplicate detection means it is safe to point it at the staging
folder again after every export.

## The offline place index

Reverse geocoding uses a packed copy of GeoNames `cities1000` — every
populated place over a thousand people, about 2.9 MB compressed — committed at
`lib/ingest/data/places.bin.gz`. It is in the repository on purpose: an index
that has to be downloaded is an index you do not have on the night you need
it.

To refresh it:

```sh
npm run build:geodata
```

The lookup is not "nearest place" but "nearest place a person would name":
standing eight kilometres outside a city you say the city, not the hamlet you
happen to be closest to, so population buys a place a bounded head start in
kilometres. Source data is CC BY 4.0 from [GeoNames](https://www.geonames.org/).

If the index is missing, ingest still runs — entries simply arrive with the
location blank, and it tells you how to build it.

## What it will not do

- **Invent a trip.** Create `content/<user>/trips/<id>/trip.md` first.
- **Write a username into frontmatter.** Media paths stay trip-relative
  (`/media/<tripId>/…`); `lib/entries.ts` prefixes the owner at read time, so
  a trip folder can be copied or handed to somebody else unchanged.
- **Guess your transport.** Except for one case that cannot be anything else:
  more than 400 km at more than 250 km/h is recorded as a flight. Trains,
  buses and cars overlap far too much to tell apart from timestamps.

## What you get is a draft

Every entry ingest writes carries `status: draft`, which keeps it off the site
— out of the story, the feed, the sitemap and the search index — until a person
deletes that line. The body it leaves behind is a placeholder (*"Write the day
here"*), and publishing that automatically is how somebody's family reads a
stub. Write the words, delete the line.
