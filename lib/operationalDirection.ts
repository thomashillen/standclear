import type { SubwayLine } from "./subwayData";

// Use the representative trip's verified platform direction, not geography.
// Older cached assets lack metadata. These exact terminal pairs are verified
// in MTA GTFS (G05S → E01S/M23S); unrelated legacy routes retain their behavior.
export function directionTowardEnd(line: SubwayLine): "N" | "S" {
  if (line.directionTowardEnd === "N" || line.directionTowardEnd === "S") {
    return line.directionTowardEnd;
  }
  const first = line.stops[0];
  const last = line.stops[line.stops.length - 1];
  const south = line.routeId === "E" ? "E01" :
    line.routeId === "J" || line.routeId === "Z" ? "M23" : undefined;
  if (south && first.id === "G05" && last.id === south) return "S";
  if (south && first.id === south && last.id === "G05") return "N";
  return first.lat > last.lat ? "S" : "N";
}


/** Static fallback only; reported realtime destinations retain precedence. */
export function directionalTermini(line: SubwayLine): { N: string; S: string } | null {
  if (line.stops.length < 2) return null;
  const first = line.stops[0], last = line.stops[line.stops.length - 1];
  return directionTowardEnd(line) === "N"
    ? { N: last.name, S: first.name }
    : { N: first.name, S: last.name };
}
