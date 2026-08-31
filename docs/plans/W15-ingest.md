# W15 — Ingest: photos, video, EXIF, geodata

**Roadmap:** E1, E2, E3, E5, E7–E10, A9, M3 · **Depends on:** W02, W03 · **Wave D**

> **The most important script in the repo.** If writing up a day takes more than
> ~10 minutes, the blog dies in month two (M3). Everything here serves that.

## Scope

### `npm run ingest -- <folder>`
Folder of photos (+ optional text) → a dated entry, ready to edit:
1. Read **EXIF** — capture time, GPS, orientation, camera
2. **Cluster** by time + location into candidate days/stops (E2)
3. **Reverse geocode** offline (E3) — GeoNames `cities1000` (~10 MB) bundled, so
   it works on bad wifi. Nominatim only as an opt-in fallback
4. **Resize** to ≤2000px derivatives; originals to `MEDIA_ORIGINALS_DIR`
5. **Strip GPS from served derivatives** (E9) — a public photo with home
   coordinates is a real leak. Keep coordinates in frontmatter, not in the file
6. Write frontmatter: date, time, location, country, lat/lng, gallery with
   width/height, transport guess
7. **Perceptual-hash dedupe** (E10) — you will import the same folder twice

### Video (E8, decision 18)
Short clips only. Hard length cap (~30 s), ffmpeg → h264/webm, poster frame,
originals never served.

### HEIC (E7)
**Verify `sharp` handles HEIC in our build before depending on it.** If not,
shell out to `ffmpeg`/`heif-convert`. Safari uploads HEIC that Chrome won't render.

### `osxphotos` recipe (E5)
Documented one-liner exporting an album with GPS intact to a staging folder,
then `npm run ingest`. This is the iCloud path.

## Acceptance
- [ ] A folder of 30 photos → a correct entry in **under 10 minutes end to end**,
      measured, including the human edit
- [ ] Works offline (no geocoding network calls)
- [ ] HEIC in, correct JPEG/WebP out, orientation right
- [ ] Served derivatives contain **no GPS EXIF**
- [ ] Re-running on the same folder changes nothing (idempotent)
- [ ] A 200 MB 4K clip is rejected or transcoded, never served raw
