"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nearbyGlanceRows, glanceEta } from "@/lib/nearbyGlance";
import { buildStationIndex } from "@/lib/stopsIndex";
import { useLines, useSubwayDataStatus } from "@/lib/subwayData";
import { useGeolocation } from "@/lib/useGeolocation";
import { useNow } from "@/lib/useNow";
import { useTrains, useFeedHealth } from "@/lib/useTrains";
import { useOnline } from "@/lib/useOnline";

function GlanceStatus({ message, loading = false }: { message: string; loading?: boolean }) {
  return (
    <div role="status" className="flex min-h-11 max-w-[230px] items-center gap-2 rounded-2xl border border-white/[0.10] bg-gray-950/90 px-2.5 py-1.5 text-[12px] text-gray-300">
      {loading ? <>
        <span aria-hidden="true" className="flex items-center gap-2 motion-safe:animate-pulse">
          <span className="size-5 rounded-full bg-white/10" />
          <span className="h-3 w-20 rounded bg-white/10" />
        </span>
        <span className="sr-only">{message}</span>
      </> : message}
    </div>
  );
}

function LoadingGlance() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const deadline = setTimeout(() => setSlow(true), 30_000);
    return () => clearTimeout(deadline);
  }, []);
  return <GlanceStatus loading={!slow} message={slow ? "Nearby arrivals taking longer" : "Finding nearby arrivals"} />;
}

export default function NearbyGlance({
  onStationOpen,
  hidden = false,
}: {
  onStationOpen: (stopId: string) => void;
  hidden?: boolean;
}) {
  const spaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const space = spaceRef.current;
    const content = contentRef.current;
    if (!space || !content) return;
    // Measure the allocated grid cell, not the arrival rows: location is
    // needed before rows exist. CSS owns the desktop/short-screen cutoffs.
    const update = () => {
      const bounds = space.getBoundingClientRect();
      setVisible(document.visibilityState === "visible" &&
        bounds.width > 0 && bounds.height > 0 &&
        getComputedStyle(content).display !== "none");
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(space);
    window.addEventListener("resize", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const [permissionSnapshot, setPermissionSnapshot] = useState<{
    value: PermissionState | "checking" | "unknown"; hidden: boolean;
  }>(() => ({ value: typeof navigator !== "undefined" && typeof navigator.permissions?.query === "function" ? "checking" : "unknown", hidden }));
  // A previous panel phase's answer cannot authorize a new automatic watch.
  const canQueryPermission = typeof navigator !== "undefined" && typeof navigator.permissions?.query === "function";
  const permission = !canQueryPermission ? "unknown" : permissionSnapshot.hidden === hidden ? permissionSnapshot.value : "checking";
  if (permissionSnapshot.hidden !== hidden) {
    // Invalidate on every transition, including a rapid open/close before
    // the intermediate permission query has settled.
    setPermissionSnapshot({ value: "checking", hidden });
  }
  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let cancelled = false;
    let sequence = 0;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let status: PermissionStatus | null = null;
    const update = () => {
      if (!cancelled && status) setPermissionSnapshot({ value: status.state, hidden });
    };
    // Some browsers keep an old PermissionStatus snapshot without emitting
    // change. Recheck metadata after panel use/focus, especially to stop
    // automatic discovery when access has been revoked.
    const query = () => {
      const request = ++sequence;
      status?.removeEventListener("change", update);
      status = null;
      if (deadline !== null) clearTimeout(deadline);
      deadline = setTimeout(() => {
        if (!cancelled && request === sequence) setPermissionSnapshot({ value: "unknown", hidden });
      }, 5_000);
      Promise.resolve().then(() => navigator.permissions.query({ name: "geolocation" })).then(
        (result) => {
          if (cancelled || request !== sequence) return;
          if (deadline !== null) clearTimeout(deadline);
          status?.removeEventListener("change", update);
          status = result;
          update();
          status.addEventListener("change", update);
        },
        () => {
          if (cancelled || request !== sequence) return;
          if (deadline !== null) clearTimeout(deadline);
          setPermissionSnapshot({ value: "unknown", hidden });
        },
      );
    };
    const recheck = () => {
      setPermissionSnapshot({ value: "checking", hidden });
      query();
    };
    const onVisibility = () => {
      // Invalidate before the next visible render, so a previously granted
      // snapshot cannot restart GPS ahead of a fresh permission response.
      setPermissionSnapshot({ value: "checking", hidden });
      if (document.visibilityState === "visible") query();
    };
    query();
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (deadline !== null) clearTimeout(deadline);
      status?.removeEventListener("change", update);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hidden]);

  // Startup discovery is intentional: request access for prompt/unknown
  // states too (Safari may not expose a reliable Permissions API). Native
  // geolocation remains the authority; never persist or assume a grant.
  const eligible = visible && !hidden;
  const active = eligible && permission !== "checking" && permission !== "denied";
  const geo = useGeolocation(active);
  const lines = useLines();
  const lineStatus = useSubwayDataStatus();
  const data = useTrains();
  const health = useFeedHealth();
  const online = useOnline();
  const clock = useNow(eligible);
  const now = Math.max(clock, geo.updatedAt ?? 0);
  const index = useMemo(() => (lines ? buildStationIndex(lines) : []), [lines]);
  const rows = useMemo(
    () =>
      active &&
      geo.lng != null &&
      geo.lat != null &&
      geo.status === "granted"
        ? nearbyGlanceRows(index, data, { lng: geo.lng, lat: geo.lat }, now / 1000)
        : [],
    [index, data, geo.lng, geo.lat, geo.status, active, now],
  );

  let message: string | null = null;
  let waiting = false;
  if (permission === "checking") waiting = true;
  else if (permission === "denied" || geo.status === "denied") message = "Location is blocked";
  else if (!online) message = "Offline · arrivals unavailable";
  else if (geo.status === "error" || geo.status === "unavailable") message = "Location unavailable";
  else if (lineStatus.error) message = "Stations unavailable";
  else if (health.consecutiveFailures > 0) message = "Arrival update delayed";
  else if (data && now - data.generatedAt >= 60_000) message = "Waiting for fresh arrivals";
  else if (geo.status !== "granted" || !lines || !data) waiting = true;
  else if (!rows.length) message = "No nearby arrivals";

  const showRows = eligible && !waiting && !message;

  return (
    <div ref={spaceRef} className={`map-glance-space sm:hidden ${hidden ? "hidden" : ""}`}>
      <div
        ref={contentRef}
        role={showRows && rows.length ? "region" : undefined}
        aria-label={showRows && rows.length ? "Nearby train arrivals" : undefined}
        className="nearby-glance flex flex-col items-start gap-1.5 sm:hidden"
      >
        {eligible && (waiting ? <LoadingGlance /> : message ? <GlanceStatus message={message} /> : null)}
        {(showRows ? rows : []).map((row) => {
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
    </div>
  );
}
