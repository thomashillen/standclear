import type { Lines } from "./subwayData";

export interface DirectRoute {
  routeId: string;
  direction: "N" | "S";
  /** How many stops between origin and destination on this route. Used to
   *  rank "best" routes when multiple options exist (the express that
   *  saves stops wins over the local that touches both ends). */
  stopCount: number;
}

/**
 * Given two station complexes (each represented by its set of member
 * stop_ids), find the routes that travel directly between them and the
 * direction the rider needs to board at the origin.
 *
 * Approach: for each line, look up the indices of any origin and any
 * destination stop_id in the line's `stops` array. If both ends are
 * present and in different positions, the line is a direct route. The
 * compass direction (N/S) is derived from the line's terminus latitudes
 * — same trick the StationPanel uses to label terminus names.
 *
 * Limitations: only direct (no-transfer) routes. Multi-leg trips would
 * need a proper graph search over transfers.txt; deferring that until
 * we have the transfer data baked into the GTFS payload.
 */
export function directRoutesBetween(
  lines: Lines,
  fromStopIds: string[],
  toStopIds: string[],
): DirectRoute[] {
  const fromSet = new Set(fromStopIds);
  const toSet = new Set(toStopIds);
  const out: DirectRoute[] = [];

  for (const line of Object.values(lines)) {
    if (line.stops.length < 2) continue;

    // First match wins for both ends — within a complex the difference
    // between platform stop_ids is tiny on the line array, and we just
    // need *some* index to compute relative direction.
    let fromIdx = -1;
    let toIdx = -1;
    for (let i = 0; i < line.stops.length; i++) {
      const id = line.stops[i].id;
      if (fromIdx === -1 && fromSet.has(id)) fromIdx = i;
      if (toIdx === -1 && toSet.has(id)) toIdx = i;
      if (fromIdx !== -1 && toIdx !== -1) break;
    }
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) continue;

    // GTFS line.stops runs terminus-to-terminus in a stable order; whether
    // stops[0] sits north or south of stops[last] tells us how to label
    // the direction the rider needs to board to travel toward the higher
    // index along the array.
    const first = line.stops[0];
    const last = line.stops[line.stops.length - 1];
    const firstIsNorth = first.lat > last.lat;
    const towardEndOfArray = toIdx > fromIdx;
    const direction: "N" | "S" = towardEndOfArray
      ? firstIsNorth
        ? "S"
        : "N"
      : firstIsNorth
        ? "N"
        : "S";

    out.push({
      routeId: line.routeId,
      direction,
      stopCount: Math.abs(toIdx - fromIdx),
    });
  }

  return out;
}
