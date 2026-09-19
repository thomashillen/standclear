"use client";

import { useEffect, useMemo, useState } from "react";
import { nearbyGlanceRows, glanceEta } from "@/lib/nearbyGlance";
import { buildStationIndex } from "@/lib/stopsIndex";
import { useLines } from "@/lib/subwayData";
import { useGeolocation } from "@/lib/useGeolocation";
import { useNow } from "@/lib/useNow";
import { useTrains } from "@/lib/useTrains";

export default function NearbyGlance({
  onStationOpen,
}: {
  onStationOpen: (stopId: string) => void;
}) {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let cancelled = false;
    let status: PermissionStatus | null = null;
    const update = () => {
      if (!cancelled && status) setPermission(status.state);
    };
    navigator.permissions.query({ name: "geolocation" }).then(
      (result) => {
        if (cancelled) return;
        status = result;
        update();
        result.addEventListener("change", update);
      },
      () => {}, // Unsupported query: keep the explicit Near me path.
    );
    return () => {
      cancelled = true;
      status?.removeEventListener("change", update);
    };
  }, []);

  // A prior grant is the only automatic entry. A first visit never
  // receives a surprise location prompt; the existing Near me control
  // remains the user-initiated path for that case.
  const geo = useGeolocation(permission === "granted");
  const lines = useLines();
  const data = useTrains();
  const now = useNow(true);
  const index = useMemo(() => (lines ? buildStationIndex(lines) : []), [lines]);
  const rows = useMemo(
    () =>
      geo.lng != null && geo.lat != null &&
      (permission === "granted" || geo.status === "granted")
        ? nearbyGlanceRows(index, data, { lng: geo.lng, lat: geo.lat }, now / 1000)
        : [],
    [index, data, geo.lng, geo.lat, geo.status, permission, now],
  );

  if (rows.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Nearby train arrivals"
      className="absolute left-3 z-20 flex flex-col items-start gap-1.5 sm:hidden"
      style={{ top: "calc(max(var(--safe-top), 0.5rem) + 4rem)" }}
    >
      {rows.map((row) => {
        // Badges name the actual next trains, not every service that
        // happens to share this color at the station.
        const nextRoutes = row.routes.filter((route) =>
          route.routeId === row.northRouteId || route.routeId === row.southRouteId,
        );
        const routeNames = nextRoutes.map((route) => route.id).join(" and ");
        const north = glanceEta(row.northEta, now / 1000);
        const south = glanceEta(row.southEta, now / 1000);
        return (
          <button
            type="button"
            key={`${row.station.stopId}:${row.color}`}
            onClick={() => onStationOpen(row.station.stopId)}
            aria-label={`${routeNames} at ${row.station.name}. Northbound ${north}, southbound ${south}. Open station.`}
            className="press flex min-h-11 max-w-[230px] items-center gap-2 rounded-2xl border border-white/[0.12] bg-gray-950/90 px-2.5 py-1.5 text-white shadow-[0_6px_18px_rgba(0,0,0,0.35)] backdrop-blur-xl touch-manipulation"
          >
            <span className="flex shrink-0 items-center gap-0.5" aria-hidden="true">
              {nextRoutes.map((route) => (
                <span
                  key={route.routeId}
                  className="nyc-bullet flex size-5 items-center justify-center rounded-full text-[11px] font-bold leading-none"
                  style={{ backgroundColor: route.color, color: route.textColor }}
                >
                  {route.id}
                </span>
              ))}
            </span>
            <span className="flex items-center gap-1.5 text-[12px] font-semibold tabular-nums whitespace-nowrap" aria-hidden="true">
              <span className="text-gray-400">↑</span>{north}
              <span className="ml-0.5 text-gray-400">↓</span>{south}
            </span>
          </button>
        );
      })}
    </div>
  );
}
