import { useI18n } from "../LocaleProvider";

export type StopScope = "trip" | "stop";

/**
 * "Whole trip / This stop": two `aria-pressed` buttons rather than native
 * radios, matching the `ViewButton` pattern already used for view toggles in
 * `WorldMap`/`TripMap` (`test/trip-map.test.tsx`'s `stopButtons()` excludes
 * this exact pair by its own text). B2420.
 */
export default function StopScopeSwitch({
  scope,
  onChange,
}: {
  scope: StopScope;
  onChange: (scope: StopScope) => void;
}) {
  const { t } = useI18n();

  return (
    <div role="group" className="inline-flex overflow-hidden rounded-lg border border-line-quiet">
      <ScopeButton active={scope === "trip"} onClick={() => onChange("trip")}>
        {t("map.wholeTrip")}
      </ScopeButton>
      <ScopeButton active={scope === "stop"} onClick={() => onChange("stop")}>
        {t("map.thisStop")}
      </ScopeButton>
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 whitespace-nowrap px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
        active
          ? "bg-action-strong text-on-action"
          : "bg-surface-base text-ink-body hover:text-ink-strong"
      }`}
    >
      {children}
    </button>
  );
}
