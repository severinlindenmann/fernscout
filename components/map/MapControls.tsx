import { mapStyle } from "@/lib/map/style";
import { useI18n } from "../LocaleProvider";

/**
 * The one control column every map surface draws from — 44 px round buttons
 * in a fixed order (zoom in, zoom out, whole trip, layers, full screen), each
 * rendered only when its callback is given. B2420 (Phase 0 item 4 of
 * docs/plans/map-redesign.md); not yet wired into TripMap/WorldMap
 * (Phase 1) — those keep their own buttons until they are restyled.
 */

export interface MapControlsProps {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFit?: () => void;
  onLayers?: () => void;
  onFullscreen?: () => void;
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-full shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      style={{
        backgroundColor: mapStyle.controlFill,
        color: mapStyle.controlIcon,
        boxShadow: `0 1px 4px ${mapStyle.controlShadow}`,
      }}
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M9 2v14M2 9h14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M2 9h14" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M6 2H2v4M12 2h4v4M6 16H2v-4M12 16h4v-4"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M9 2 2 6l7 4 7-4-7-4Z M2 9l7 4 7-4 M2 12l7 4 7-4"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MapControls({ onZoomIn, onZoomOut, onFit, onLayers, onFullscreen }: MapControlsProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-1.5">
      {onZoomIn && (
        <ControlButton label={t("map.zoomIn")} onClick={onZoomIn}>
          <PlusIcon />
        </ControlButton>
      )}
      {onZoomOut && (
        <ControlButton label={t("map.zoomOut")} onClick={onZoomOut}>
          <MinusIcon />
        </ControlButton>
      )}
      {onFit && (
        <ControlButton label={t("map.reset")} onClick={onFit}>
          <FitIcon />
        </ControlButton>
      )}
      {onLayers && (
        <ControlButton label={t("map.layers")} onClick={onLayers}>
          <LayersIcon />
        </ControlButton>
      )}
      {onFullscreen && (
        <ControlButton label={t("map.fullscreen")} onClick={onFullscreen}>
          <FullscreenIcon />
        </ControlButton>
      )}
    </div>
  );
}
