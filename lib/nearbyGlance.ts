import type { TrainsResponse } from "./useTrains";
import {
  nearestStations,
  type NearbyStation,
  type StationEntry,
} from "./stopsIndex";

export type NearbyGlanceRow = {
  station: NearbyStation;
  color: string;
  routes: StationEntry["routes"];
  northEta: number | null;
  southEta: number | null;
  northRouteId: string | null;
  southRouteId: string | null;
};

// A small map overlay should represent nearby *stations*, not merge
// same-named stops that have no in-system transfer (Rector St is one).
// Group services sharing a station and route color into one compact row.
export function nearbyGlanceRows(
  index: StationEntry[],
  data: TrainsResponse | null,
  location: { lng: number; lat: number },
  nowSec: number,
): NearbyGlanceRow[] {
  if (!data || nowSec - data.generatedAt / 1000 > 60) return [];

  const trainById = new Map(data.trains.map((train) => [train.id, train]));
  const groups: NearbyGlanceRow[] = [];
  for (const station of nearestStations(index, location.lng, location.lat, 8)) {
    if (station.meters > 900) continue;
    const byColor = new Map<string, NearbyGlanceRow>();
    for (const route of station.routes) {
      const group = byColor.get(route.color) ?? {
        station,
        color: route.color,
        routes: [],
        northEta: null,
        southEta: null,
        northRouteId: null,
        southRouteId: null,
      };
      group.routes.push(route);
      byColor.set(route.color, group);
    }

    const stopIds = new Set(station.stopIds);
    const arrivals = data.arrivals.filter((arrival) => {
      const train = trainById.get(arrival.tripId);
      return (
        stopIds.has(arrival.stopId) &&
        arrival.eta >= nowSec - 5 &&
        arrival.eta <= nowSec + 45 * 60 &&
        (train?.lastReportedAt == null || nowSec - train.lastReportedAt <= 90)
      );
    });
    // The MTA omits a train's current platform from future arrival
    // updates. Include a fresh STOPPED_AT report as "Now".
    for (const train of data.trains) {
      if (
        train.status === "STOPPED_AT" &&
        stopIds.has(train.prevStopId) &&
        (train.lastReportedAt == null || nowSec - train.lastReportedAt <= 90)
      ) {
        arrivals.push({
          routeId: train.routeId,
          stopId: train.prevStopId,
          direction: train.direction,
          eta: nowSec,
          tripId: train.id,
        });
      }
    }

    for (const arrival of arrivals) {
      const routeId = arrival.routeId.endsWith("X")
        ? arrival.routeId.slice(0, -1)
        : arrival.routeId;
      const group = Array.from(byColor.values()).find((entry) =>
        entry.routes.some((route) => route.routeId === routeId),
      );
      if (!group) continue;
      const field = arrival.direction === "N" ? "northEta" : "southEta";
      if (arrival.eta < (group[field] ?? Infinity)) {
        group[field] = arrival.eta;
        group[arrival.direction === "N" ? "northRouteId" : "southRouteId"] = routeId;
      }
    }
    groups.push(
      ...Array.from(byColor.values()).filter(
        (group) => group.northEta != null || group.southEta != null,
      ),
    );
  }

  groups.sort((a, b) =>
    a.station.meters - b.station.meters ||
    Math.min(a.northEta ?? Infinity, a.southEta ?? Infinity) -
      Math.min(b.northEta ?? Infinity, b.southEta ?? Infinity),
  );
  return groups.slice(0, 3);
}

export function glanceEta(eta: number | null, nowSec: number): string {
  if (eta == null) return "—";
  const remaining = eta - nowSec;
  return remaining < 45 ? "Now" : `${Math.ceil(remaining / 60)}m`;
}
