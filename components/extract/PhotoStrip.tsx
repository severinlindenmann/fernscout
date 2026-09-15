"use client";

import PhotoTile, { type PhotoBadge, type PhotoTileSize } from "@/components/extract/PhotoTile";

export type PhotoStripItem = {
  id: string;
  kind: "image" | "video";
  src?: string | null;
  file?: File | null;
  alt: string;
  badge?: PhotoBadge;
};

/**
 * A row of tiles, or a grid of them — B1803 Task 1.2.
 *
 * One component either way, per the design's own two uses: five square
 * thumbnails across a day card (`columns={5}`, `size="strip"`) and three or
 * four across the upload screen's grid (`columns={3 or 4}`, `size="grid"`).
 * What differs between the two is only the column count and the tile size;
 * the caller says both rather than this component guessing from how many
 * photographs it was handed.
 */
export default function PhotoStrip({
  photos,
  size,
  columns,
  selectedId,
  onSelect,
}: {
  photos: PhotoStripItem[];
  size: PhotoTileSize;
  columns: number;
  selectedId?: string;
  /** Absent for a strip nobody can tap into (e.g. a read-only day summary). */
  onSelect?: (id: string) => void;
}) {
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {photos.map((photo) => (
        <PhotoTile
          key={photo.id}
          size={size}
          kind={photo.kind}
          src={photo.src}
          file={photo.file}
          alt={photo.alt}
          badge={photo.badge}
          selected={selectedId === photo.id}
          onPress={onSelect ? () => onSelect(photo.id) : undefined}
        />
      ))}
    </div>
  );
}
